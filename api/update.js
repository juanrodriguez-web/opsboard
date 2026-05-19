// POST /api/update — uploads a queue JSON to Drive so Apps Script applies it
// Body: { tema, estado?, notas? }
const { google } = require('googleapis')
const { Readable } = require('stream')

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { tema, estado, notas, propietario, prioridad, fechaFin, proyecto } = req.body || {}
  if (!tema) return res.status(400).json({ error: 'tema is required' })

  try {
    const auth  = getAuth()
    const drive = google.drive({ version: 'v3', auth })

    const row = { Tema: tema }
    if (estado       != null) row['Estado']                 = estado
    if (notas        != null) row['Notas']                  = notas
    if (propietario  != null) row['Propietario']            = propietario
    if (prioridad    != null) row['Prioridad']              = prioridad
    if (fechaFin     != null) row['Fecha de finalización']  = fechaFin
    if (proyecto     != null) row['Proyecto']               = proyecto

    const payload = {
      action:    'upsert',
      createdAt: new Date().toISOString(),
      source:    'OpsBoard Web App',
      rows:      [row],
    }

    const fname   = `upsert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    const content = JSON.stringify(payload, null, 2)

    await drive.files.create({
      requestBody: {
        name:     fname,
        mimeType: 'application/json',
        parents:  [process.env.QUEUE_FOLDER_ID],
      },
      media: {
        mimeType: 'application/json',
        body:     Readable.from([content]),
      },
    })

    res.json({ ok: true })
  } catch (err) {
    console.error('[api/update]', err.message)
    res.status(500).json({ error: err.message })
  }
}
