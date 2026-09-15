import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Printer,
  Save,
  Wifi,
  WifiOff,
  Loader2,
  ChefHat,
  Flame,
  Beer,
  Monitor,
  Copy,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import {
  setPrintServerUrl,
  isNetworkPrinterAvailable,
  setStationPrinterUrl,
  isStationPrinterAvailable,
} from '../../lib/networkPrinter'

interface Props {
  onBack: () => void
}

interface StationPrinter {
  key: string
  label: string
  description: string
  icon: React.ReactNode
  settingId: string
}

const STATIONS: StationPrinter[] = [
  {
    key: 'kitchen',
    label: 'Kitchen Printer',
    description: 'Auto-prints order tickets for kitchen items when orders are placed',
    icon: <ChefHat size={18} className="text-orange-400" />,
    settingId: 'kitchen_printer_url',
  },
  {
    key: 'griller',
    label: 'Griller Printer',
    description: 'Auto-prints order tickets for grill items when orders are placed',
    icon: <Flame size={18} className="text-red-400" />,
    settingId: 'griller_printer_url',
  },
  {
    key: 'mixologist',
    label: 'Mixologist Printer',
    description: 'Sends cocktail tickets to the mixologist station instead of bar chiller',
    icon: <ChefHat size={18} className="text-emerald-400" />,
    settingId: 'mixologist_printer_url',
  },
]

export default function PrinterConfig({ onBack }: Props) {
  const toast = useToast()
  const [serverUrl, setServerUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)

  const [stationUrls, setStationUrls] = useState<Record<string, string>>({})
  const [stationTesting, setStationTesting] = useState<Record<string, boolean>>({})
  const [stationTestResults, setStationTestResults] = useState<
    Record<string, 'success' | 'fail' | null>
  >({})
  const [stationSaving, setStationSaving] = useState(false)

  // Station modes: 'display' | 'printer' | 'both'
  const [stationModes, setStationModes] = useState<Record<string, string>>({
    kitchen: 'display',
    griller: 'display',
    bar: 'display',
    mixologist: 'display',
  })
  const [printCopies, setPrintCopies] = useState<Record<string, number>>({
    kitchen: 2,
    griller: 2,
    bar: 1,
    mixologist: 1,
  })
  const [modesSaving, setModesSaving] = useState(false)

  useEffect(() => {
    // Load all printer settings at once
    supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'print_server_url',
        'station_modes',
        'print_copies',
        ...STATIONS.map((s) => s.settingId),
      ])
      .then(({ data }) => {
        if (!data) return
        for (const row of data) {
          if (row.id === 'print_server_url' && row.value) {
            setServerUrl(row.value)
            setPrintServerUrl(row.value)
          }
          if (row.id === 'station_modes' && row.value) {
            try {
              setStationModes((prev) => ({ ...prev, ...JSON.parse(row.value) }))
            } catch {
              /* */
            }
          }
          if (row.id === 'print_copies' && row.value) {
            try {
              setPrintCopies((prev) => ({ ...prev, ...JSON.parse(row.value) }))
            } catch {
              /* */
            }
          }
          const station = STATIONS.find((s) => s.settingId === row.id)
          if (station && row.value) {
            setStationUrls((prev) => ({ ...prev, [station.key]: row.value }))
            setStationPrinterUrl(station.key, row.value)
          }
        }
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('settings')
        .upsert(
          { id: 'print_server_url', value: serverUrl.trim(), updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
      if (error) throw error
      if (serverUrl.trim()) {
        setPrintServerUrl(serverUrl.trim())
      }
      toast.success('Printer settings saved')
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    if (serverUrl.trim()) {
      setPrintServerUrl(serverUrl.trim())
    }
    const available = await isNetworkPrinterAvailable()
    setTestResult(available ? 'success' : 'fail')
    setTesting(false)
  }

  const handleStationTest = async (station: StationPrinter) => {
    setStationTesting((prev) => ({ ...prev, [station.key]: true }))
    setStationTestResults((prev) => ({ ...prev, [station.key]: null }))
    const url = stationUrls[station.key]?.trim()
    if (url) setStationPrinterUrl(station.key, url)
    const available = await isStationPrinterAvailable(station.key)
    setStationTestResults((prev) => ({ ...prev, [station.key]: available ? 'success' : 'fail' }))
    setStationTesting((prev) => ({ ...prev, [station.key]: false }))
  }

  const handleStationsSave = async () => {
    setStationSaving(true)
    try {
      for (const station of STATIONS) {
        const url = stationUrls[station.key]?.trim() || ''
        const { error } = await supabase.from('settings').upsert(
          {
            id: station.settingId,
            value: url,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        if (error) throw error
        setStationPrinterUrl(station.key, url)
      }
      toast.success('Station printers saved')
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : String(e))
    } finally {
      setStationSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-gray-950 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <div className="max-w-lg space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Printer size={20} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">Printer Configuration</h2>
            <p className="text-gray-400 text-sm">Network thermal printer settings</p>
          </div>
        </div>

        {/* Receipt Printer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">Receipt Printer</p>
            <ul className="text-gray-400 text-xs space-y-1.5">
              <li>• Receipts always print via browser print dialog (guaranteed)</li>
              <li>
                • If a network print server is configured, receipts also print on your thermal
                printer automatically
              </li>
              <li>
                • The print server must be running on your local network (e.g. a Raspberry Pi or PC
                connected to the thermal printer)
              </li>
              <li>• Leave empty to use browser printing only</li>
            </ul>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Print Server URL</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.100:6543"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-600"
            />
            <p className="text-gray-500 text-xs mt-1.5">
              The URL of your local print server (including port). Example:
              http://192.168.1.100:6543
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing || !serverUrl.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
              {testing ? 'Testing...' : 'Test Connection'}
            </button>

            {testResult === 'success' && (
              <span className="flex items-center gap-1.5 text-green-400 text-sm">
                <Wifi size={14} /> Connected — printer is reachable
              </span>
            )}
            {testResult === 'fail' && (
              <span className="flex items-center gap-1.5 text-red-400 text-sm">
                <WifiOff size={14} /> Not reachable — check URL and ensure server is running
              </span>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Receipt Printer'}
          </button>
        </div>

        {/* Station Printers */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">Station Printers</p>
            <ul className="text-gray-400 text-xs space-y-1.5">
              <li>
                • Assign a dedicated printer to kitchen and/or griller stations so order tickets
                print automatically when orders are placed
              </li>
              <li>
                • Each station printer needs its own print server running on the network, connected
                to the station's thermal printer
              </li>
              <li>• Stations without a printer configured will use the KDS screen instead</li>
              <li>• Bar orders always go to the bar KDS screen</li>
            </ul>
          </div>

          {STATIONS.map((station) => (
            <div key={station.key} className="space-y-3">
              <div className="flex items-center gap-2">
                {station.icon}
                <div>
                  <p className="text-white text-sm font-medium">{station.label}</p>
                  <p className="text-gray-500 text-xs">{station.description}</p>
                </div>
              </div>

              <input
                type="text"
                value={stationUrls[station.key] || ''}
                onChange={(e) =>
                  setStationUrls((prev) => ({ ...prev, [station.key]: e.target.value }))
                }
                placeholder={`http://192.168.1.${station.key === 'kitchen' ? '101' : '102'}:6543`}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-600"
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleStationTest(station)}
                  disabled={stationTesting[station.key] || !stationUrls[station.key]?.trim()}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-xs hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {stationTesting[station.key] ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Wifi size={12} />
                  )}
                  {stationTesting[station.key] ? 'Testing...' : 'Test'}
                </button>

                {stationTestResults[station.key] === 'success' && (
                  <span className="flex items-center gap-1 text-green-400 text-xs">
                    <Wifi size={12} /> Reachable
                  </span>
                )}
                {stationTestResults[station.key] === 'fail' && (
                  <span className="flex items-center gap-1 text-red-400 text-xs">
                    <WifiOff size={12} /> Not reachable
                  </span>
                )}

                {stationUrls[station.key]?.trim() && (
                  <button
                    onClick={() => {
                      setStationUrls((prev) => ({ ...prev, [station.key]: '' }))
                      setStationTestResults((prev) => ({ ...prev, [station.key]: null }))
                    }}
                    className="text-gray-500 hover:text-red-400 text-xs transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={handleStationsSave}
            disabled={stationSaving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {stationSaving ? 'Saving...' : 'Save Station Printers'}
          </button>
        </div>

        {/* Station Modes */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">Station Output Modes</p>
            <ul className="text-gray-400 text-xs space-y-1.5">
              <li>
                • <span className="text-white">Display Only</span> — orders appear on the KDS
                screen, no printing
              </li>
              <li>
                • <span className="text-white">Printer Only</span> — orders auto-print, KDS screen
                shows no new orders
              </li>
              <li>
                • <span className="text-white">Both</span> — orders appear on KDS AND auto-print
              </li>
              <li>
                • Set <span className="text-white">copies</span> to 2 for kitchen/griller so they
                keep one and give one out
              </li>
            </ul>
          </div>

          {[
            {
              key: 'kitchen',
              label: 'Kitchen',
              icon: <ChefHat size={16} className="text-orange-400" />,
            },
            {
              key: 'griller',
              label: 'Griller',
              icon: <Flame size={16} className="text-red-400" />,
            },
            { key: 'bar', label: 'Bar', icon: <Beer size={16} className="text-cyan-400" /> },
          ].map((station) => (
            <div key={station.key} className="space-y-2">
              <div className="flex items-center gap-2">
                {station.icon}
                <p className="text-white text-sm font-medium">{station.label}</p>
              </div>
              <div className="flex gap-2">
                {(['display', 'printer', 'both'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setStationModes((prev) => ({ ...prev, [station.key]: mode }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border-2 transition-all ${
                      stationModes[station.key] === mode
                        ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                        : 'border-gray-700 bg-gray-800 text-gray-500'
                    }`}
                  >
                    {mode === 'display' && <Monitor size={12} />}
                    {mode === 'printer' && <Printer size={12} />}
                    {mode === 'both' && (
                      <>
                        <Monitor size={10} />
                        <span>+</span>
                        <Printer size={10} />
                      </>
                    )}
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              {(station.key === 'kitchen' ||
                station.key === 'griller' ||
                stationModes[station.key] === 'printer' ||
                stationModes[station.key] === 'both') && (
                <div className="flex items-center gap-3 pl-6">
                  <Copy size={12} className="text-gray-500" />
                  <span className="text-gray-400 text-xs">Print copies:</span>
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPrintCopies((prev) => ({ ...prev, [station.key]: n }))}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                        printCopies[station.key] === n
                          ? 'bg-amber-500 text-black'
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          <button
            onClick={async () => {
              setModesSaving(true)
              try {
                await Promise.all([
                  supabase.from('settings').upsert(
                    {
                      id: 'station_modes',
                      value: JSON.stringify(stationModes),
                      updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'id' }
                  ),
                  supabase.from('settings').upsert(
                    {
                      id: 'print_copies',
                      value: JSON.stringify(printCopies),
                      updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'id' }
                  ),
                ])
                toast.success('Station modes saved')
              } catch (e) {
                toast.error('Failed to save', e instanceof Error ? e.message : String(e))
              } finally {
                setModesSaving(false)
              }
            }}
            disabled={modesSaving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {modesSaving ? 'Saving...' : 'Save Station Modes'}
          </button>
        </div>

        {/* One-click print server installer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div>
            <p className="text-gray-300 text-sm font-medium mb-1">Print Server Installer</p>
            <p className="text-gray-500 text-xs">
              Download a one-click installer for each POS computer. Enter the printer IP, download
              the .bat file, copy it to the POS computer, right-click → Run as Administrator. It
              installs Node.js, the print server, and sets it to start automatically on boot.
            </p>
          </div>

          {[
            {
              label: 'Kitchen Printer',
              defaultIp: '192.168.0.134',
              desc: 'For kitchen/griller ticket auto-printing',
            },
            { label: 'Receipt Printer', defaultIp: '192.168.0.10', desc: 'For customer receipts' },
          ].map((printer) => {
            const stateKey = `installer_ip_${printer.label}`
            return (
              <div key={printer.label} className="bg-gray-800 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-white text-sm font-medium">{printer.label}</p>
                  <p className="text-gray-500 text-[10px]">{printer.desc}</p>
                </div>
                <input
                  id={stateKey}
                  type="text"
                  defaultValue={printer.defaultIp}
                  placeholder="Printer IP (e.g. 192.168.0.134)"
                  className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500 font-mono"
                />
                <button
                  onClick={() => {
                    const ip =
                      (document.getElementById(stateKey) as HTMLInputElement)?.value?.trim() ||
                      printer.defaultIp

                    // Generate the complete server.js as a string
                    const _serverJs = `// Kolondiro Print Server — Auto-generated
const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')

let config = { printer_ip: '${ip}', printer_port: 9100, server_port: 6543 }
const configPath = path.join(__dirname, 'config.json')
try { if (fs.existsSync(configPath)) { config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) } } } catch {}

const PRINTER_IP = config.printer_ip, PRINTER_PORT = config.printer_port, SERVER_PORT = config.server_port
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' }

function sendToPrinter(data) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket(), t = setTimeout(() => { s.destroy(); reject(new Error('Timeout')) }, 5000)
    s.connect(PRINTER_PORT, PRINTER_IP, () => { s.write(data, (e) => { if (e) { clearTimeout(t); s.destroy(); reject(e); return }; setTimeout(() => { clearTimeout(t); s.destroy(); resolve() }, 500) }) })
    s.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method === 'GET' && req.url === '/health') {
    let st = 'unknown'
    try { await new Promise((r, j) => { const s = new net.Socket(); s.setTimeout(2000); s.connect(PRINTER_PORT, PRINTER_IP, () => { st='reachable'; s.destroy(); r() }); s.on('error', () => { st='unreachable'; s.destroy(); r() }); s.on('timeout', () => { st='timeout'; s.destroy(); r() }) }) } catch { st='error' }
    res.writeHead(200, CORS); res.end(JSON.stringify({ status: 'ok', printer: PRINTER_IP+':'+PRINTER_PORT, printer_status: st })); return
  }
  if (req.method === 'POST' && req.url === '/config') {
    let b = []; req.on('data', c => b.push(c)); req.on('end', () => { try { const u = { ...config, ...JSON.parse(Buffer.concat(b).toString()) }; fs.writeFileSync(configPath, JSON.stringify(u, null, 2)); config = u; res.writeHead(200, CORS); res.end(JSON.stringify({ success: true })) } catch (e) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: e.message })) } }); return
  }
  if (req.method === 'POST' && (req.url === '/print' || req.url === '/print-text' || req.url === '/print-html')) {
    let b = []; req.on('data', c => b.push(c)); req.on('end', async () => {
      try {
        const j = JSON.parse(Buffer.concat(b).toString()); let d
        if (j.text) d = Buffer.from(j.text, 'utf8')
        else if (j.data && Array.isArray(j.data)) d = Buffer.from(j.data)
        else if (j.html) d = Buffer.from(j.html.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' '), 'utf8')
        else { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'No data' })); return }
        await sendToPrinter(d); console.log('Printed ' + d.length + ' bytes')
        res.writeHead(200, CORS); res.end(JSON.stringify({ success: true }))
      } catch (e) { console.error('Print error:', e.message); res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message })) }
    }); return
  }
  res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'Not found' }))
}).listen(SERVER_PORT, '0.0.0.0', () => { console.log('Print Server ready on port ' + SERVER_PORT + ' -> ' + PRINTER_IP + ':' + PRINTER_PORT) })
`
                      .replace(/\\/g, '\\\\')
                      .replace(/"/g, '\\"')
                      .replace(/\n/g, '\\n')

                    const batContent = [
                      '@echo off',
                      'echo ================================================',
                      'echo   Kolondiro Print Server Installer',
                      'echo   Printer IP: ' + ip,
                      'echo ================================================',
                      'echo.',
                      '',
                      'REM Check admin rights',
                      'net session >nul 2>&1',
                      'if %errorlevel% neq 0 (',
                      '    echo ERROR: Run this as Administrator!',
                      '    echo Right-click the file and select "Run as administrator"',
                      '    pause',
                      '    exit /b 1',
                      ')',
                      '',
                      'REM Check Node.js — install automatically if missing',
                      'where node >nul 2>nul',
                      'if %errorlevel% neq 0 (',
                      '    echo Node.js not found. Installing automatically...',
                      '    echo Downloading Node.js v20 LTS...',
                      "    powershell -Command \"Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi' -OutFile '%TEMP%\\node_install.msi'\"",
                      '    if not exist "%TEMP%\\node_install.msi" (',
                      '        echo Download failed. Check your internet connection.',
                      '        pause',
                      '        exit /b 1',
                      '    )',
                      '    echo Installing Node.js silently...',
                      '    msiexec /i "%TEMP%\\node_install.msi" /qn /norestart',
                      '    del "%TEMP%\\node_install.msi" 2>nul',
                      '    echo Refreshing PATH...',
                      '    set "PATH=%PATH%;C:\\Program Files\\nodejs"',
                      '    timeout /t 3 /nobreak >nul',
                      '    where node >nul 2>nul',
                      '    if %errorlevel% neq 0 (',
                      '        echo Node.js install failed. Please install manually from https://nodejs.org',
                      '        pause',
                      '        exit /b 1',
                      '    )',
                      '    echo Node.js installed successfully!',
                      ')',
                      'echo Node.js found: ',
                      'node --version',
                      '',
                      'REM Stop and remove old service/tasks',
                      'net stop KolondiroPrint 2>nul',
                      'sc delete KolondiroPrint 2>nul',
                      'schtasks /delete /tn "KolondiroPrint" /f 2>nul',
                      'taskkill /f /im node.exe 2>nul',
                      'timeout /t 2 /nobreak >nul',
                      '',
                      'REM Create directory',
                      'if not exist "C:\\KolondiroPrint" mkdir "C:\\KolondiroPrint"',
                      '',
                      'REM Write config.json',
                      '(echo {) > "C:\\KolondiroPrint\\config.json"',
                      '(echo   "printer_ip": "' + ip + '",) >> "C:\\KolondiroPrint\\config.json"',
                      '(echo   "printer_port": 9100,) >> "C:\\KolondiroPrint\\config.json"',
                      '(echo   "server_port": 6543) >> "C:\\KolondiroPrint\\config.json"',
                      '(echo }) >> "C:\\KolondiroPrint\\config.json"',
                      '',
                      'REM Write server.js using PowerShell (handles multi-line cleanly)',
                      'echo Writing print server...',
                      'powershell -Command "$s = @\'',
                      'const http = require(\\\"http\\\"), net = require(\\\"net\\\"), fs = require(\\\"fs\\\"), path = require(\\\"path\\\");',
                      'let config = { printer_ip: \\\"' +
                        ip +
                        '\\\", printer_port: 9100, server_port: 6543 };',
                      'const configPath = path.join(__dirname, \\\"config.json\\\");',
                      'try { if (fs.existsSync(configPath)) config = { ...config, ...JSON.parse(fs.readFileSync(configPath, \\\"utf8\\\")) }; } catch {}',
                      'const PIP = config.printer_ip, PP = config.printer_port, SP = config.server_port;',
                      'const C = { \\\"Access-Control-Allow-Origin\\\": \\\"*\\\", \\\"Access-Control-Allow-Methods\\\": \\\"POST,GET,OPTIONS\\\", \\\"Access-Control-Allow-Headers\\\": \\\"Content-Type\\\", \\\"Content-Type\\\": \\\"application/json\\\" };',
                      'function stp(d) { return new Promise((rv, rj) => { const s = new net.Socket(); const t = setTimeout(() => { s.destroy(); rj(new Error(\\\"Timeout\\\")); }, 5000); s.connect(PP, PIP, () => { s.write(d, (e) => { if (e) { clearTimeout(t); s.destroy(); rj(e); return; } setTimeout(() => { clearTimeout(t); s.destroy(); rv(); }, 500); }); }); s.on(\\\"error\\\", (e) => { clearTimeout(t); rj(e); }); }); }',
                      'http.createServer(async (q, r) => {',
                      '  if (q.method === \\\"OPTIONS\\\") { r.writeHead(204, C); r.end(); return; }',
                      '  if (q.method === \\\"GET\\\" && q.url === \\\"/health\\\") { let st = \\\"unknown\\\"; try { await new Promise((rv) => { const s = new net.Socket(); s.setTimeout(2000); s.connect(PP, PIP, () => { st = \\\"reachable\\\"; s.destroy(); rv(); }); s.on(\\\"error\\\", () => { st = \\\"unreachable\\\"; s.destroy(); rv(); }); s.on(\\\"timeout\\\", () => { st = \\\"timeout\\\"; s.destroy(); rv(); }); }); } catch { st = \\\"error\\\"; } r.writeHead(200, C); r.end(JSON.stringify({ status: \\\"ok\\\", printer: PIP + \\\":\\\" + PP, printer_status: st })); return; }',
                      '  if (q.method === \\\"POST\\\") { let b = []; q.on(\\\"data\\\", (c) => b.push(c)); q.on(\\\"end\\\", async () => { try { const j = JSON.parse(Buffer.concat(b).toString()); let d; if (j.text) d = Buffer.from(j.text, \\\"utf8\\\"); else if (j.data && Array.isArray(j.data)) d = Buffer.from(j.data); else if (j.html) d = Buffer.from(j.html.replace(/<[^>]*>/g, \\\"\\\"), \\\"utf8\\\"); else { r.writeHead(400, C); r.end(JSON.stringify({ error: \\\"No data\\\" })); return; } await stp(d); console.log(\\\"Printed \\\" + d.length + \\\" bytes\\\"); r.writeHead(200, C); r.end(JSON.stringify({ success: true })); } catch (e) { console.error(\\\"Error:\\\", e.message); r.writeHead(500, C); r.end(JSON.stringify({ error: e.message })); } }); return; }',
                      '  r.writeHead(404, C); r.end(JSON.stringify({ error: \\\"Not found\\\" }));',
                      '}).listen(SP, \\\"0.0.0.0\\\", () => console.log(\\\"Print Server ready on \\\" + SP + \\\" -> \\\" + PIP + \\\":\\\" + PP));',
                      "'@; $s | Out-File -FilePath 'C:\\KolondiroPrint\\server.js' -Encoding UTF8\"",
                      '',
                      'REM Write watchdog script — restarts node if it crashes, runs forever hidden',
                      'echo Writing watchdog...',
                      '(echo Do) > "C:\\KolondiroPrint\\watchdog.vbs"',
                      '(echo   Set objShell = CreateObject^("WScript.Shell"^)) >> "C:\\KolondiroPrint\\watchdog.vbs"',
                      '(echo   objShell.Run "cmd /c cd /d C:\\KolondiroPrint ^&^& node server.js", 0, True) >> "C:\\KolondiroPrint\\watchdog.vbs"',
                      '(echo   WScript.Sleep 3000) >> "C:\\KolondiroPrint\\watchdog.vbs"',
                      '(echo Loop) >> "C:\\KolondiroPrint\\watchdog.vbs"',
                      '',
                      'REM Create scheduled task — runs at SYSTEM STARTUP (before login), as SYSTEM user',
                      'echo Setting up auto-start...',
                      'schtasks /create /tn "KolondiroPrint" /tr "wscript.exe C:\\KolondiroPrint\\watchdog.vbs" /sc onstart /ru SYSTEM /rl highest /f',
                      '',
                      "REM Also create a logon backup task (in case onstart doesn't fire on some machines)",
                      'schtasks /create /tn "KolondiroPrintLogon" /tr "wscript.exe C:\\KolondiroPrint\\watchdog.vbs" /sc onlogon /rl highest /f',
                      '',
                      'REM Also put in Startup folder as triple backup',
                      'copy /y "C:\\KolondiroPrint\\watchdog.vbs" "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\KolondiroPrint.vbs" >nul 2>nul',
                      '',
                      'REM Start it now',
                      'echo Starting print server...',
                      'taskkill /f /im wscript.exe 2>nul',
                      'timeout /t 1 /nobreak >nul',
                      'start "" wscript.exe "C:\\KolondiroPrint\\watchdog.vbs"',
                      '',
                      'REM Wait and verify',
                      'timeout /t 4 /nobreak >nul',
                      'echo.',
                      'echo Testing connection...',
                      'curl -s http://localhost:6543/health 2>nul || echo Could not reach server yet - it may need a moment',
                      'echo.',
                      'echo.',
                      'echo ================================================',
                      'echo   SUCCESS! Print server installed.',
                      'echo.',
                      'echo   Printer IP: ' + ip,
                      'echo   Server: http://localhost:6543',
                      'echo.',
                      'echo   It runs PERMANENTLY in the background:',
                      'echo   - Starts on boot (before login)',
                      'echo   - Restarts if it crashes (watchdog)',
                      'echo   - Survives logout and closing windows',
                      'echo   - No external software needed',
                      'echo ================================================',
                      'echo.',
                      'pause',
                    ].join('\r\n')

                    const blob = new Blob([batContent], { type: 'application/bat' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `INSTALL_PRINT_SERVER_${ip.replace(/\./g, '_')}.bat`
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                    toast.success(
                      'Downloaded',
                      `Right-click the .bat file → Run as Administrator on the POS computer`
                    )
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
                >
                  <Save size={14} /> Download Installer (.bat)
                </button>
              </div>
            )
          })}

          <div className="bg-gray-800/50 rounded-lg p-3 space-y-1.5 text-gray-500 text-xs">
            <p className="text-gray-400 font-medium">Instructions:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Enter the printer IP for each POS computer above</li>
              <li>Download the .bat file for each one</li>
              <li>Copy each .bat to its POS computer (USB or download directly)</li>
              <li>
                Right-click → <span className="text-white">Run as Administrator</span>
              </li>
              <li>It installs Node.js check, print server, and auto-start — done!</li>
            </ol>
            <p className="text-gray-600 mt-2">
              Requires{' '}
              <a href="https://nodejs.org" target="_blank" className="text-amber-400 underline">
                Node.js
              </a>{' '}
              installed on the POS computer.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
