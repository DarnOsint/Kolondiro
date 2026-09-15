// Network print client — talks to a local print server on the venue's LAN.
// The print server IP/port is configurable (defaults to localhost:6543 for dev).
// Supports multiple station printers (receipt, kitchen, griller).

import type { ItemDestination } from '../types'

let printServerUrl = 'http://localhost:6543'

const stationPrinterUrls: Record<string, string> = {}

/** Set the receipt print server URL at runtime (called from settings/config) */
export function setPrintServerUrl(url: string) {
  printServerUrl = url
}

/** Set a station-specific printer URL (kitchen, griller) */
export function setStationPrinterUrl(station: string, url: string) {
  if (url.trim()) {
    stationPrinterUrls[station] = url.trim()
  } else {
    delete stationPrinterUrls[station]
  }
}

/** Get a station printer URL, or null if not configured */
export function getStationPrinterUrl(station: string): string | null {
  return stationPrinterUrls[station] || null
}

/** Check if any station printers are configured */
export function hasStationPrinters(): boolean {
  return Object.keys(stationPrinterUrls).length > 0
}

/** Get all configured station destinations */
export function getConfiguredStations(): string[] {
  return Object.keys(stationPrinterUrls)
}

export async function isNetworkPrinterAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${printServerUrl}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Check if a specific station printer is reachable */
export async function isStationPrinterAvailable(station: string): Promise<boolean> {
  const url = stationPrinterUrls[station]
  if (!url) return false
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function printViaNetwork(data: Uint8Array): Promise<boolean> {
  try {
    const res = await fetch(`${printServerUrl}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: Array.from(data) }),
      signal: AbortSignal.timeout(5000),
    })
    const json = await res.json()
    return json.success === true
  } catch {
    return false
  }
}

/** Print to a specific station printer — supports multiple copies */
export async function printToStation(
  station: ItemDestination,
  data: Uint8Array,
  copies = 1
): Promise<boolean> {
  const url = stationPrinterUrls[station]
  if (!url) return false
  try {
    for (let i = 0; i < copies; i++) {
      const res = await fetch(`${url}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: Array.from(data), copies: 1 }),
        signal: AbortSignal.timeout(5000),
      })
      const json = await res.json()
      if (json.success !== true) return false
    }
    return true
  } catch {
    return false
  }
}

/** Print HTML to a station printer (fallback for printers that don't support ESC/POS) */
export async function printHtmlToStation(
  station: ItemDestination,
  html: string,
  copies = 1
): Promise<boolean> {
  const url = stationPrinterUrls[station]
  if (!url) return false
  try {
    for (let i = 0; i < copies; i++) {
      const res = await fetch(`${url}/print-html`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
        signal: AbortSignal.timeout(5000),
      })
      const json = await res.json()
      if (json.success !== true) {
        await fetch(`${url}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html }),
          signal: AbortSignal.timeout(5000),
        })
      }
    }
    return true
  } catch {
    return false
  }
}
