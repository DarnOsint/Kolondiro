// Kolondiro — Local Print Server
// Runs on localhost:6543 on the POS machine
// Receives ESC/POS bytes from the browser and forwards to printer IP:9100
// Config: reads printer IP from config.json if present, else uses default

const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')

// Load config
let config = { printer_ip: '192.168.0.10', printer_port: 9100, server_port: 6543 }
const configPath = path.join(__dirname, 'config.json')
try {
  if (fs.existsSync(configPath)) {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config = { ...config, ...loaded }
    console.log('Config loaded from config.json')
  }
} catch (e) {
  console.log('Using default config')
}

const PRINTER_IP = config.printer_ip
const PRINTER_PORT = config.printer_port
const SERVER_PORT = config.server_port

// CORS headers so kolondiro.vercel.app can call localhost
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

const { execSync } = require('child_process')
const os = require('os')

// Method 1: Raw TCP to printer IP:port (network printers)
function sendViaTCP(data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Printer connection timed out'))
    }, 5000)

    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(data, (err) => {
        if (err) {
          clearTimeout(timeout)
          socket.destroy()
          reject(err)
          return
        }
        setTimeout(() => {
          clearTimeout(timeout)
          socket.destroy()
          resolve()
        }, 500)
      })
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

// Method 2: Write temp file and use Windows print command (for printers added as devices)
function sendViaWindows(data) {
  return new Promise((resolve, reject) => {
    try {
      const tmpFile = path.join(os.tmpdir(), `kolondiro_print_${Date.now()}.txt`)
      fs.writeFileSync(tmpFile, data)
      // Try to find the printer name that matches the IP
      // First try: direct print via Windows 'print' command
      try {
        execSync(`print /d:"\\\\${PRINTER_IP}\\printer" "${tmpFile}"`, { timeout: 5000, stdio: 'ignore' })
        fs.unlinkSync(tmpFile)
        resolve()
        return
      } catch {}
      // Second try: use 'copy' to the printer port (LPT/RAW)
      try {
        execSync(`copy /b "${tmpFile}" "\\\\${PRINTER_IP}\\receipt"`, { timeout: 5000, stdio: 'ignore' })
        fs.unlinkSync(tmpFile)
        resolve()
        return
      } catch {}
      // Third try: use PowerShell to print to default printer
      try {
        execSync(`powershell -Command "Get-Content '${tmpFile}' | Out-Printer"`, { timeout: 10000, stdio: 'ignore' })
        fs.unlinkSync(tmpFile)
        resolve()
        return
      } catch {}
      // Fourth try: use raw TCP to port 9100 via PowerShell
      try {
        execSync(`powershell -Command "$c = New-Object System.Net.Sockets.TcpClient('${PRINTER_IP}', ${PRINTER_PORT}); $s = $c.GetStream(); $b = [IO.File]::ReadAllBytes('${tmpFile}'); $s.Write($b, 0, $b.Length); $s.Close(); $c.Close()"`, { timeout: 10000, stdio: 'ignore' })
        fs.unlinkSync(tmpFile)
        resolve()
        return
      } catch {}
      try { fs.unlinkSync(tmpFile) } catch {}
      reject(new Error('All Windows print methods failed'))
    } catch (err) {
      reject(err)
    }
  })
}

// Try TCP first, then Windows methods
async function sendToPrinter(data) {
  try {
    await sendViaTCP(data)
    return
  } catch (tcpErr) {
    console.log(`TCP print failed (${tcpErr.message}), trying Windows methods...`)
  }
  await sendViaWindows(data)
}

const server = http.createServer(async (req, res) => {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    // Test printer connection
    let printerStatus = 'unknown'
    try {
      await new Promise((resolve, reject) => {
        const sock = new net.Socket()
        sock.setTimeout(2000)
        sock.connect(PRINTER_PORT, PRINTER_IP, () => {
          printerStatus = 'reachable'
          sock.destroy()
          resolve()
        })
        sock.on('error', () => { printerStatus = 'unreachable'; sock.destroy(); resolve() })
        sock.on('timeout', () => { printerStatus = 'timeout'; sock.destroy(); resolve() })
      })
    } catch { printerStatus = 'error' }

    res.writeHead(200, CORS_HEADERS)
    res.end(JSON.stringify({
      status: 'ok',
      printer: `${PRINTER_IP}:${PRINTER_PORT}`,
      printer_status: printerStatus,
      server_port: SERVER_PORT,
    }))
    return
  }

  // Config endpoint — update printer IP
  if (req.method === 'POST' && req.url === '/config') {
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', () => {
      try {
        const buf = Buffer.concat(body)
        const newConfig = JSON.parse(buf.toString())
        const updated = { ...config, ...newConfig }
        fs.writeFileSync(configPath, JSON.stringify(updated, null, 2))
        config = updated
        res.writeHead(200, CORS_HEADERS)
        res.end(JSON.stringify({ success: true, config: updated }))
        console.log(`Config updated: printer=${updated.printer_ip}:${updated.printer_port}`)
      } catch (err) {
        res.writeHead(400, CORS_HEADERS)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // Print endpoint — accepts { data: [bytes] } or { text: "plain string" }
  if (req.method === 'POST' && (req.url === '/print' || req.url === '/print-text')) {
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(body)
        const json = JSON.parse(buf.toString())

        let printData

        if (json.text && typeof json.text === 'string') {
          // Plain text — convert to bytes directly (works on all thermal printers)
          printData = Buffer.from(json.text, 'utf8')
        } else if (json.data && Array.isArray(json.data)) {
          // Raw byte array (ESC/POS or plain text bytes)
          printData = Buffer.from(json.data)
        } else if (json.html && typeof json.html === 'string') {
          // HTML — strip tags and send as plain text (basic fallback)
          const plainText = json.html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          printData = Buffer.from(plainText, 'utf8')
        } else {
          res.writeHead(400, CORS_HEADERS)
          res.end(JSON.stringify({ error: 'Missing data, text, or html field' }))
          return
        }

        await sendToPrinter(printData)
        console.log(`[${new Date().toLocaleTimeString()}] Printed ${printData.length} bytes OK`)
        res.writeHead(200, CORS_HEADERS)
        res.end(JSON.stringify({ success: true, bytes: printData.length }))
      } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Print error:`, err.message)
        res.writeHead(500, CORS_HEADERS)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // Print HTML endpoint — strips tags and prints as text
  if (req.method === 'POST' && req.url === '/print-html') {
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(body)
        const json = JSON.parse(buf.toString())
        if (!json.html) {
          res.writeHead(400, CORS_HEADERS)
          res.end(JSON.stringify({ error: 'Missing html field' }))
          return
        }
        // Strip HTML tags → plain text → send to printer
        const plainText = json.html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        const printData = Buffer.from(plainText, 'utf8')
        await sendToPrinter(printData)
        console.log(`[${new Date().toLocaleTimeString()}] Printed HTML (${printData.length} bytes) OK`)
        res.writeHead(200, CORS_HEADERS)
        res.end(JSON.stringify({ success: true, bytes: printData.length }))
      } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Print error:`, err.message)
        res.writeHead(500, CORS_HEADERS)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  res.writeHead(404, CORS_HEADERS)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log('='.repeat(50))
  console.log("  Kolondiro — Print Server")
  console.log('='.repeat(50))
  console.log(`  Listening on  0.0.0.0:${SERVER_PORT}`)
  console.log(`  Printer IP    ${PRINTER_IP}:${PRINTER_PORT}`)
  console.log('='.repeat(50))
  console.log('  Ready to receive print jobs...')
  console.log()
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${SERVER_PORT} already in use. Print server may already be running.`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})
