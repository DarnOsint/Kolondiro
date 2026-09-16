// ESC/POS Thermal Printer Hook
// Uses WebSerial API — sends bytes directly to printer, no browser dialog

const ESC = 0x1b
const GS = 0x1d

const cmd = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  bold: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  doubleSize: [ESC, 0x21, 0x30],
  normalSize: [ESC, 0x21, 0x00],
  cut: [GS, 0x56, 0x42, 0x00],
  feed: (n: number) => [ESC, 0x64, n],
  // Increase print darkness/contrast (best-effort, ignored by printers that
  // don't support density commands). Prevents faded receipts on network printers.
  density: [0x1d, 0x28, 0x45, 0x03, 0x02, 0x00, 0x05, 0x04],
} as const

function text(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

function row(left: string, right: string, width = 40): number[] {
  const space = width - left.length - right.length
  if (space <= 0) return text(left.substring(0, width - right.length - 1) + ' ' + right + '\n')
  return text(left + ' '.repeat(space) + right + '\n')
}

export interface ReceiptData {
  order: { created_at: string; order_type: string; payment_method?: string | null }
  items: Array<{
    quantity: number
    total_price: number
    extra_charge?: number
    modifier_notes?: string | null
    menu_items?: { name: string } | null
    name?: string
    return_accepted?: boolean
    return_requested?: boolean
    status?: string
  }>
  table?: { name: string } | null
  staffName?: string
  orderRef: string
  subtotal: number
  vatAmount: number
  total: number
  tipAmount?: number
  amountReceived?: number
}

export function buildReceipt(data: ReceiptData): Uint8Array {
  const {
    order,
    items,
    table,
    staffName,
    orderRef,
    total,
    tipAmount = 0,
    amountReceived = 0,
  } = data
  const W = 40
  const bytes: number[] = []
  const push = (...chunks: (number | number[] | readonly number[])[]) =>
    chunks.forEach((c) =>
      Array.isArray(c) ? bytes.push(...(c as number[])) : bytes.push(c as number)
    )

  const divider = '-'.repeat(W) + '\n'
  const solidDivider = '='.repeat(W) + '\n'
  const centre = (str: string) => {
    const pad = Math.max(0, Math.floor((W - str.length) / 2))
    return ' '.repeat(pad) + str + '\n'
  }

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-SS', { day: '2-digit', month: 'short', year: 'numeric' })
  const fmtTime = (d: string) =>
    new Date(d).toLocaleTimeString('en-SS', { hour: '2-digit', minute: '2-digit', hour12: true })

  const pmRaw = (order.payment_method ?? '').toLowerCase()
  const pmLabel = pmRaw.startsWith('transfer:')
    ? `TRANSFER - ${pmRaw.replace('transfer:', '').toUpperCase()}`
    : pmRaw === 'cash'
      ? 'CASH'
      : pmRaw === 'card'
        ? 'BANK POS'
        : pmRaw === 'credit'
          ? 'PAY LATER'
          : pmRaw.toUpperCase()

  push(cmd.init)
  // Increase darkness to avoid faded output on network/thermal printers
  push(cmd.density)
  push(cmd.alignCenter)
  push(cmd.doubleSize, ...text("KOLONDIRO\n"), cmd.normalSize)
  push(cmd.bold, ...text('Lounge & Restaurant\n'), cmd.boldOff)
  push(cmd.alignLeft)
  push(text(divider))
  push(row('Ref:', orderRef))
  push(row('Table:', table?.name ?? (order.order_type === 'takeaway' ? 'Takeaway' : 'Counter')))
  push(row('Date:', fmtDate(order.created_at)))
  push(row('Time:', fmtTime(order.created_at)))
  push(row('Served by:', (staffName ?? '').substring(0, 20)))
  push(row('Payment:', pmLabel))
  push(text(divider))
  push(cmd.bold, ...text('ITEM                          AMOUNT\n'), cmd.boldOff)
  push(text(divider))

  push(cmd.bold)
  items
    .filter(
      (item) =>
        !item.return_accepted &&
        !item.return_requested &&
        (item.status || '').toLowerCase() !== 'cancelled'
    )
    .forEach((item) => {
      const name = `${item.quantity}x ${(item.menu_items?.name ?? item.name ?? '').substring(0, 22)}`
      const price = `SSP${(item.total_price ?? 0).toLocaleString()}`
      push(row(name, price))
      if (item.modifier_notes) push(text(`  > ${item.modifier_notes.substring(0, 36)}\n`))
    })
  push(cmd.boldOff)

  push(text(solidDivider))
  push(
    cmd.bold,
    ...row(
      'TOTAL:',
      `SSP${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ),
    cmd.boldOff
  )

  if (tipAmount > 0) {
    const received = amountReceived > 0 ? amountReceived : total + tipAmount
    push(text(divider))
    push(
      row(
        'Amt Received:',
        `SSP${received.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      )
    )
    push(
      row(
        'Tip (Thank you!):',
        `SSP${tipAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      )
    )
  }

  push(text(solidDivider))
  push(cmd.alignCenter)
  push(text(centre('** PAYMENT CONFIRMED **')))
  push(text('\n'))
  push(text(centre('Thank you for visiting')))
  push(text(centre("Kolondiro")))
  push(cmd.feed(3))
  push(cmd.cut)

  return new Uint8Array(bytes)
}

// Saved port reference — persists across renders but reset on close/error
let savedPort: SerialPort | null = null

export function useThermalPrinter() {
  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator

  // Get a working port — auto-reconnect to saved port, or ask user
  const getPort = async (): Promise<SerialPort | null> => {
    if (!isSupported) return null

    const serial = navigator as Navigator & {
      serial: {
        requestPort: () => Promise<SerialPort>
        getPorts: () => Promise<SerialPort[]>
      }
    }

    // Try previously permitted port first
    if (!savedPort) {
      try {
        const ports = await serial.serial.getPorts()
        if (ports.length > 0) savedPort = ports[0]
      } catch (_e) {
        /* none saved */
      }
    }

    // If no saved port, prompt user to select
    if (!savedPort) {
      try {
        savedPort = await serial.serial.requestPort()
      } catch (_e) {
        return null
      }
    }

    return savedPort
  }

  const printReceipt = async (data: ReceiptData, fallbackFn?: () => void): Promise<void> => {
    if (!isSupported) {
      fallbackFn?.()
      return
    }

    const port = await getPort()
    if (!port) {
      fallbackFn?.()
      return
    }

    let writer: WritableStreamDefaultWriter | null = null

    try {
      // Always open fresh — close first if already open
      try {
        await port.close()
      } catch (_e) {
        /* not open, fine */
      }

      await port.open({ baudRate: 9600 })
      writer = port.writable!.getWriter()
      await writer.write(buildReceipt(data))
      await writer.close()
      writer = null
      await port.close()
    } catch (e) {
      console.warn('Thermal print error:', e)
      // Release locks before falling back
      try {
        writer?.releaseLock()
      } catch (_e) {
        /* ok */
      }
      try {
        await port.close()
      } catch (_e) {
        /* ok */
      }
      savedPort = null // Reset so next attempt re-selects
      fallbackFn?.()
    }
  }

  const connect = async (): Promise<boolean> => {
    const port = await getPort()
    return !!port
  }

  const disconnect = async (): Promise<void> => {
    try {
      await savedPort?.close()
    } catch (_e) {
      /* ok */
    }
    savedPort = null
  }

  return { isSupported, connect, printReceipt, disconnect }
}
