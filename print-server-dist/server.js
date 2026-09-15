const http = require('http')
const net = require('net')

const PRINTER_IP = '192.168.0.10'
const PRINTER_PORT = 9100
const SERVER_PORT = 6543

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

function sendToPrinter(data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const t = setTimeout(() => { socket.destroy(); reject(new Error('Timeout')) }, 5000)
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(data, (err) => {
        if (err) { clearTimeout(t); socket.destroy(); reject(err); return }
        setTimeout(() => { clearTimeout(t); socket.destroy(); resolve() }, 500)
      })
    })
    socket.on('error', (err) => { clearTimeout(t); reject(err) })
  })
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, CORS)
    res.end(JSON.stringify({ status: 'ok', printer: PRINTER_IP + ':' + PRINTER_PORT }))
    return
  }
  if (req.method === 'POST' && req.url === '/print') {
    let body = []
    req.on('data', c => body.push(c))
    req.on('end', async () => {
      try {
        const json = JSON.parse(Buffer.concat(body).toString())
        await sendToPrinter(Buffer.from(json.data))
        console.log('[' + new Date().toLocaleTimeString() + '] Printed ' + json.data.length + ' bytes OK')
        res.writeHead(200, CORS); res.end(JSON.stringify({ success: true }))
      } catch (e) {
        console.error('[ERROR]', e.message)
        res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }
  res.writeHead(404, CORS); res.end('{}')
}).listen(SERVER_PORT, '127.0.0.1', () => {
  console.log('╔══════════════════════════════════════════╗')
  console.log("║   Kolondiro — Print Server         ║")
  console.log('╠══════════════════════════════════════════╣')
  console.log('║  localhost:' + SERVER_PORT + '  →  ' + PRINTER_IP + ':' + PRINTER_PORT + '  ║')
  console.log('╠══════════════════════════════════════════╣')
  console.log('║  Ready. Keep this window open.           ║')
  console.log('╚══════════════════════════════════════════╝')
})
