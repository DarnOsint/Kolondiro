import { useState, useEffect } from 'react'
import { ArrowLeft, Printer, Plus, Trash2, Loader2, Wifi, WifiOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

interface Props {
  onBack: () => void
}

interface NetworkPrinter {
  id: string
  name: string
  label: string
  ip: string
  port: number
  type: string
  enabled: boolean
}

const PRINTER_LABELS = [
  { id: 'receipt', label: 'Receipt Printer', desc: 'Customer receipts at POS' },
  { id: 'kitchen', label: 'Kitchen Printer', desc: 'Auto-prints kitchen order tickets' },
  { id: 'bar', label: 'Bar Printer', desc: 'Auto-prints bar order tickets' },
  { id: 'griller', label: 'Griller Printer', desc: 'Auto-prints grill order tickets' },
  { id: 'waitron', label: 'Waitron Printer', desc: 'Pre-payment bills for waitrons' },
  { id: 'office', label: 'Office Printer', desc: 'Reports and summaries' },
]

export default function NetworkPrinters({ onBack }: Props) {
  const toast = useToast()
  const [printers, setPrinters] = useState<NetworkPrinter[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<NetworkPrinter | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'fail'>>({})

  const blankPrinter: NetworkPrinter = {
    id: '',
    name: '',
    label: 'receipt',
    ip: '',
    port: 9100,
    type: 'thermal',
    enabled: true,
  }
  const [form, setForm] = useState<NetworkPrinter>(blankPrinter)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'network_printers')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          try {
            setPrinters(JSON.parse(data.value))
          } catch {
            /* invalid */
          }
        }
        setLoading(false)
      })
  }, [])

  const savePrinters = async (list: NetworkPrinter[]) => {
    const { error } = await supabase.from('settings').upsert(
      {
        id: 'network_printers',
        value: JSON.stringify(list),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    if (error) throw error
    setPrinters(list)
  }

  const handleSave = async () => {
    if (!form.name || !form.ip) {
      toast.warning('Required', 'Printer name and IP address are required')
      return
    }
    setSaving(true)
    try {
      const printer = { ...form, id: form.id || `prn_${Date.now()}` }
      const updated = editing
        ? printers.map((p) => (p.id === editing.id ? printer : p))
        : [...printers, printer]
      await savePrinters(updated)

      // Also update the station printer URLs in settings for the print server
      for (const p of updated) {
        if (p.enabled && ['kitchen', 'griller', 'receipt'].includes(p.label)) {
          const settingId = p.label === 'receipt' ? 'print_server_url' : `${p.label}_printer_url`
          await supabase.from('settings').upsert(
            {
              id: settingId,
              value: `http://${p.ip}:${p.port === 9100 ? 6543 : p.port}`,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
        }
      }

      setForm(blankPrinter)
      setShowAdd(false)
      setEditing(null)
      toast.success(editing ? 'Printer Updated' : 'Printer Added')
    } catch (e) {
      toast.error('Error', (e as { message?: string })?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const removePrinter = async (id: string) => {
    if (!confirm('Remove this printer?')) return
    setSaving(true)
    try {
      await savePrinters(printers.filter((p) => p.id !== id))
      toast.success('Printer Removed')
    } catch (e) {
      toast.error('Error', (e as { message?: string })?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const testPrinter = async (printer: NetworkPrinter) => {
    setTesting(printer.id)
    try {
      // Try print server HTTP health check first (port 6543)
      const httpPort = printer.port === 9100 ? 6543 : printer.port
      const url = `http://${printer.ip}:${httpPort}/health`
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      setTestResults((prev) => ({ ...prev, [printer.id]: res.ok ? 'ok' : 'fail' }))
    } catch {
      // HTTP failed — try a basic fetch to the IP (checks if device is reachable)
      try {
        await fetch(`http://${printer.ip}/`, { signal: AbortSignal.timeout(2000), mode: 'no-cors' })
        // no-cors fetch succeeding means the device responded (even if we can't read it)
        setTestResults((prev) => ({ ...prev, [printer.id]: 'ok' }))
      } catch {
        setTestResults((prev) => ({ ...prev, [printer.id]: 'fail' }))
      }
    } finally {
      setTesting(null)
    }
  }

  const getLabelInfo = (label: string) => PRINTER_LABELS.find((l) => l.id === label)

  const inp =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500'

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={24} />
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Printer size={20} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">Network Printers</h2>
            <p className="text-gray-400 text-sm">Configure all thermal printers on the network</p>
          </div>
        </div>

        {/* Printer list */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-semibold">Printers ({printers.length})</p>
          <button
            onClick={() => {
              setForm(blankPrinter)
              setEditing(null)
              setShowAdd(true)
            }}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 text-sm font-medium"
          >
            <Plus size={14} /> Add Printer
          </button>
        </div>

        {printers.length === 0 && !showAdd && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center mb-4">
            <Printer size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No printers configured</p>
            <p className="text-gray-600 text-xs mt-1">Add your network thermal printers</p>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {printers.map((printer) => {
            const info = getLabelInfo(printer.label)
            return (
              <div
                key={printer.id}
                className={`bg-gray-900 border rounded-xl p-4 ${printer.enabled ? 'border-gray-800' : 'border-red-500/30 opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white text-sm font-semibold">{printer.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                        {info?.label || printer.label}
                      </span>
                    </div>
                    <p className="text-gray-400 text-xs font-mono">
                      {printer.ip}:{printer.port}
                    </p>
                    {info && <p className="text-gray-600 text-[10px] mt-0.5">{info.desc}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => testPrinter(printer)}
                      disabled={testing === printer.id}
                      className="text-gray-400 hover:text-white p-1"
                    >
                      {testing === printer.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : testResults[printer.id] === 'ok' ? (
                        <Wifi size={14} className="text-green-400" />
                      ) : testResults[printer.id] === 'fail' ? (
                        <WifiOff size={14} className="text-red-400" />
                      ) : (
                        <Wifi size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setForm(printer)
                        setEditing(printer)
                        setShowAdd(true)
                      }}
                      className="text-gray-400 hover:text-white p-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removePrinter(printer.id)}
                      className="text-gray-400 hover:text-red-400 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Add/Edit Form */}
        {showAdd && (
          <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-5 space-y-4 mb-4">
            <p className="text-amber-400 font-semibold text-sm">
              {editing ? 'Edit Printer' : 'New Printer'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Printer Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Kitchen Thermal"
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Function / Label</label>
                <select
                  value={form.label}
                  onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                  className={inp}
                >
                  {PRINTER_LABELS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">IP Address</label>
                <input
                  value={form.ip}
                  onChange={(e) => setForm((p) => ({ ...p, ip: e.target.value }))}
                  placeholder="192.168.100.50"
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, port: parseInt(e.target.value) || 9100 }))
                  }
                  className={inp}
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-gray-400 text-xs">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                  className="rounded"
                />
                Printer enabled
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-2.5 text-sm"
              >
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Printer'}
              </button>
              <button
                onClick={() => {
                  setShowAdd(false)
                  setEditing(null)
                }}
                className="flex-1 bg-gray-800 text-gray-300 rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Print Server Install */}
        <div className="bg-gray-900 border border-emerald-500/30 rounded-xl p-5 mb-4 space-y-3">
          <p className="text-white font-semibold text-sm">Print Server Setup (Windows)</p>
          <p className="text-gray-400 text-xs">
            Install the print server on each POS computer that has a printer connected via LAN
            cable.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href="https://github.com/DarnOsint/Kolondiro/releases/download/v1.0-print-server/KolondiroPrint.exe"
              className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl py-3 text-sm transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer size={16} /> Download KolondiroPrint.exe
            </a>
            <a
              href="https://github.com/DarnOsint/Kolondiro/releases/download/v1.0-print-server/INSTALL_SERVICE.bat"
              className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl py-3 text-sm transition-colors border border-gray-700"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer size={16} /> Download Auto-Installer
            </a>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-gray-300 text-xs font-medium mb-2">Quick Install (2 steps):</p>
            <ol className="text-gray-500 text-xs space-y-1 list-decimal list-inside">
              <li>Download both files to the same folder on the POS computer</li>
              <li>
                Right-click the <span className="text-amber-400 font-mono">.bat</span> file →{' '}
                <span className="text-white">Run as Administrator</span>
              </li>
            </ol>
            <p className="text-gray-600 text-[10px] mt-2">
              It installs silently, runs in the background with no window, and auto-starts on every
              boot. No typing or configuration needed.
            </p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-gray-300 text-xs font-medium mb-1">After installing:</p>
            <p className="text-gray-500 text-xs">
              Set the Print Server URL in the printer config above to{' '}
              <span className="text-amber-400 font-mono">http://localhost:6543</span> — this tells
              the POS to send print jobs to the local print server on that computer.
            </p>
          </div>
          <a
            href="https://github.com/DarnOsint/Kolondiro/releases/download/v1.0-print-server/SETUP_AUTO_OPEN.bat"
            className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl py-3 text-sm transition-colors border border-gray-700 w-full"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Printer size={16} /> Download Auto-Open on Boot (opens kolondiro.vercel.app on startup)
          </a>
        </div>

        {/* Setup guide */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-gray-300 text-sm font-medium">Network Setup Guide</p>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <p className="text-amber-400 text-xs font-bold mb-1">
              Important: Same Network Required
            </p>
            <p className="text-amber-400/80 text-[11px]">
              The printer must be on the same WiFi as the POS devices (Kolondiro 5g). A
              printer on 192.168.0.x cannot be reached from 192.168.100.x.
            </p>
          </div>
          <ul className="text-gray-500 text-xs space-y-1.5">
            <li>
              <span className="text-white font-medium">Step 1:</span> Connect LAN cable from laptop
              to printer
            </li>
            <li>
              <span className="text-white font-medium">Step 2:</span> Open printer web page (e.g.
              http://192.168.0.10)
            </li>
            <li>
              <span className="text-white font-medium">Step 3:</span> WiFi settings → connect to
              "Kolondiro 5g"
            </li>
            <li>
              <span className="text-white font-medium">Step 4:</span> Printer gets new IP on
              192.168.100.x — find it via router or config print
            </li>
            <li>
              <span className="text-white font-medium">Step 5:</span> Enter that new IP here with
              the correct function label
            </li>
            <li>
              <span className="text-white font-medium">Step 6:</span> Test connection — green icon =
              reachable
            </li>
          </ul>
          <p className="text-gray-600 text-[10px]">
            Port 9100 = direct raw printing · Port 6543 = via print server
          </p>
        </div>
      </div>
    </div>
  )
}
