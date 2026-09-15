const express = require('express')
const app = express()
app.use(express.json())

app.post('/api/insights', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.k-ant-api03-m9_ORvkOKDn598iv7gpD5lUj_ki5_Hb1XwqKSSnpjTuFTHBfASBB80fkkOSxlE5_KuTvhCi7jY-b5b0CY2MBYw-AlXHuAAA,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    })
    const data = await response.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(3001, () => console.log('Proxy running on 3001'))
