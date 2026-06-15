// POST /api/append — appends new items to the Temas sheet tab
// Requires the service account to have EDITOR access on the Google Sheet

const { google } = require('googleapis')

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

// Find the tab that has the Temas structure (looks at first 10 rows of each tab)
async function findTemasSheet(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.SHEET_ID,
    fields: 'sheets.properties.title',
  })
  const titles = meta.data.sheets.map(s => s.properties.title)
  console.log('[append] tabs found:', titles)

  for (const title of titles) {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `'${title}'!A1:Z10`,  // read first 10 rows, not just row 1
    })
    const rows = resp.data.values || []
    for (const row of rows) {
      if (
        row.some(c => String(c).trim() === 'Objetivo') &&
        row.some(c => String(c).trim() === 'Prioridad') &&
        row.some(c => String(c).trim() === 'Notas')
      ) {
        console.log('[append] Temas sheet found:', title, '| headers:', row)
        return { title, headers: row.map(c => String(c).trim()) }
      }
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

  console.log('[append] request for', items.length, 'items')

  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    const found = await findTemasSheet(sheets)
    if (!found) {
      console.error('[append] could not find Temas sheet')
      return res.status(404).json({ error: 'Temas sheet not found — check that headers Objetivo/Prioridad/Notas exist' })
    }

    const { title, headers } = found

    // Build rows matching exact column order from the sheet
    const rows = items.map(item => {
      const row = new Array(headers.length).fill('')
      const set = (colName, val) => {
        const idx = headers.findIndex(h => norm(h) === norm(colName))
        if (idx >= 0) row[idx] = val ?? ''
      }
      set('Tema',                   item.tema || '')
      set('Objetivo',               item.objetivo || '')
      set('Prioridad',              item.prioridad || riskToPrioridad(item.risk || 'green'))
      set('Propietario',            item.propietario || '')
      set('Estado',                 'No iniciado')
      set('Notas',                  item.notas || 'Creado desde IA Intake')
      set('Proyecto',               item.proyecto || '')
      set('Fecha de finalización',  fmtDate(item.fechaFin))
      set('Fecha de inicio',        fmtDate(item.fechaInicio))
      return row
    })

    console.log('[append] writing rows:', JSON.stringify(rows.slice(0,1)))

    await sheets.spreadsheets.values.append({
      spreadsheetId:    process.env.SHEET_ID,
      range:            `'${title}'!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: rows },
    })

    console.log(`[append] wrote ${rows.length} items to '${title}'`)
    res.json({ ok: true, appended: rows.length, sheet: title })
  } catch (err) {
    console.error('[append] error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
