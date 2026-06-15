// POST /api/append — appends new items to the Temas sheet tab
// Requires the service account to have EDITOR access on the Google Sheet
// and the spreadsheets scope (not readonly)

const { google } = require('googleapis')

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

// Find the tab that looks like the Temas table
async function findTemasSheet(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.SHEET_ID,
    fields: 'sheets.properties.title',
  })
  const titles = meta.data.sheets.map(s => s.properties.title)

  for (const title of titles) {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `'${title}'!1:1`,
    })
    const firstRow = resp.data.values?.[0] || []
    // Same heuristic as parser.js buildItems
    if (firstRow.includes('Objetivo') && firstRow.includes('Prioridad') && firstRow.includes('Notas')) {
      return { title, headers: firstRow }
    }
  }
  return null
}

const riskToPrioridad = r => r === 'red' ? 'P1' : r === 'yellow' ? 'P2' : 'P3'

const fmtDate = d => {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt)) return ''
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { items } = req.body || {}
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items[] required' })
  }

  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    const found = await findTemasSheet(sheets)
    if (!found) return res.status(404).json({ error: 'Temas sheet not found' })

    const { title, headers } = found

    // Build rows matching exact column order from the sheet
    const rows = items.map(item => {
      const row = new Array(headers.length).fill('')
      const set = (colName, val) => {
        const idx = headers.findIndex(h => norm(h) === norm(colName))
        if (idx >= 0) row[idx] = val ?? ''
      }
      set('Tema',                    item.tema || '')
      set('Objetivo',                item.objetivo || '')
      set('Prioridad',               item.prioridad || riskToPrioridad(item.risk || 'green'))
      set('Propietario',             item.propietario || '')
      set('Estado',                  'No iniciado')
      set('Notas',                   item.notas || 'Creado desde IA Intake')
      set('Proyecto',                item.proyecto || '')
      set('Fecha de finalización',   fmtDate(item.fechaFin))
      set('Fecha de inicio',         fmtDate(item.fechaInicio))
      return row
    })

    await sheets.spreadsheets.values.append({
      spreadsheetId:  process.env.SHEET_ID,
      range:          `'${title}'!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:    { values: rows },
    })

    console.log(`[append] wrote ${rows.length} items to sheet '${title}'`)
    res.json({ ok: true, appended: rows.length, sheet: title })
  } catch (err) {
    console.error('[append] error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
