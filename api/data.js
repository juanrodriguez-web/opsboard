// GET /api/data — reads the Google Sheet via Sheets API v4
const { google } = require('googleapis')

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  })
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    // 1. Get all tab names
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SHEET_ID,
      fields: 'sheets.properties.title',
    })
    const titles = meta.data.sheets.map(s => s.properties.title)

    // 2. Read all tabs
    const ranges = titles.map(t => `'${t}'!A:Z`)
    const batch  = await sheets.spreadsheets.values.batchGet({
      spreadsheetId:     process.env.SHEET_ID,
      ranges,
      valueRenderOption: 'FORMATTED_VALUE',
    })

    // 3. Flatten all tabs into one array, separated by blank rows
    const allValues = []
    for (const vr of batch.data.valueRanges || []) {
      if (vr.values && vr.values.length) {
        allValues.push(...vr.values)
        allValues.push([]) // blank separator between tabs
      }
    }

    res.setHeader('Cache-Control', 'no-store')
    res.json({ values: allValues, updatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[api/data]', err.message)
    res.status(500).json({ error: err.message })
  }
}
