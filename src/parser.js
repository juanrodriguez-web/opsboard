// ── Sheet data parser (array-of-arrays from Sheets API v4) ──────────────────

export const norm = s =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

export const mapSt = s => {
  const n = norm(s)
  if (n === 'no iniciado')            return 'pending'
  if (n === 'not started')            return 'pending'
  if (n === 'en riesgo')              return 'blocked'
  if (n === 'at risk')                return 'blocked'
  if (n === 'completado')             return 'done'
  if (n === 'completed')              return 'done'
  if (n === 'in progress')            return 'inprogress'
  if (n === 'según lo planificado')   return 'inprogress'
  if (n === 'en curso')               return 'inprogress'
  if (n === 'bau')                    return 'inprogress'
  if (n === 'en peligro')             return 'blocked'
  if (n === 'retrasado')              return 'blocked'
  if (n === 'hecho')                  return 'done'
  return 'pending'
}

export const mapRisk = p => {
  if (!p) return 'green'
  const n = p.trim().toUpperCase()
  if (n === 'P0' || n === 'P1') return 'red'
  if (n === 'P2') return 'yellow'
  return 'green'
}

export const inferCat = (tema, obj = '') => {
  const t = norm(tema + ' ' + obj)
  // CVM takes priority — campaigns, retention, loyalty, upsell
  if (/\bcvm\b|retencion|retention|fideliz|upgrade|downsell|upsell|loyalty|campana cvm|campaña cvm|ciclo de vida|cdv/.test(t))
    return 'cvm'
  if (/app|email|onboarding|esim|kyc|digital|campan|redes|notipush|webview|comunicaci|metricas|dracarys|grifo|login|registro/.test(t))
    return 'product'
  if (/frontal|kiosco|retail|bpmn|manual|plataforma|sistema|atc|vending|panel|distribuidor/.test(t))
    return 'tools'
  return 'projects'
}

export const parseFecha = s => {
  if (!s || s.trim() === '') return null
  s = s.trim()
  // YYYY-MM-DD (from <input type="date"> / localStorage overrides) — must come first
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3])
  // DD/MM/YYYY (from Google Sheets FORMATTED_VALUE in ES locale)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  // Excel serial number
  const n = Number(s)
  if (!isNaN(n) && n > 40000 && n < 60000)
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000)
  return null
}

// Parse array-of-arrays (from Sheets API) into table objects
export function parseSheetValues(allValues) {
  const tables = []
  let heads = null
  let rows = []

  for (const row of allValues) {
    const nonEmpty = (row || []).filter(c => c !== '' && c != null)
    if (nonEmpty.length === 0) {
      if (heads && rows.length) tables.push({ heads, rows })
      heads = null; rows = []
      continue
    }
    if (!heads) {
      heads = row.map(c => String(c || '').trim())
    } else {
      const obj = {}
      row.forEach((cell, i) => {
        if (heads[i]) obj[heads[i]] = String(cell || '').trim()
      })
      rows.push(obj)
    }
  }
  if (heads && rows.length) tables.push({ heads, rows })
  return tables
}

export function parseCampanas(tables) {
  const t = tables.find(t => t.heads.some(h => norm(h) === 'pyname'))
  if (!t) return []
  const hFind = key => t.heads.find(h => norm(h) === key) || key
  const fFecha     = hFind('fecha')
  const fPyname    = hFind('pyname')
  const fTipo      = hFind('tipo')
  const fAudiencia = hFind('audiencia')
  const fVolumen   = hFind('volumen')
  const fCopy      = hFind('copy')
  const fCanal     = hFind('canal')
  const fEstado    = hFind('estado')
  return t.rows
    .filter(r => r[fPyname] && r[fPyname].trim())
    .map(r => ({
      id:        Math.random().toString(36).slice(2, 9),
      fecha:     r[fFecha]     || '',
      pyname:    r[fPyname]    || '',
      tipo:      r[fTipo]      || '',
      audiencia: r[fAudiencia] || '',
      volumen:   r[fVolumen]   || '',
      copy:      r[fCopy]      || '',
      canal:     r[fCanal]     || 'SMS',
      estado:    r[fEstado]    || 'Planificado',
    }))
}

const uid = () => Math.random().toString(36).slice(2, 9)

export function parseProyectos(tables) {
  // Detect Proyectos table: has 'nombre' header but not 'pyname' (campañas) nor 'objetivo' (temas)
  const t = tables.find(t =>
    t.heads.some(h => norm(h) === 'nombre') &&
    !t.heads.some(h => norm(h) === 'pyname') &&
    !t.heads.some(h => norm(h) === 'objetivo')
  )
  if (!t) return []
  const col = key => t.heads.find(h => norm(h) === norm(key)) || ''
  const fNombre      = col('Nombre')
  const fDesc   = col('Descripción') || col('Descripcion')
  const fEstado = col('Estado')
  const fPrio   = col('Prioridad')
  const fProp   = col('Propietario')
  const fIni    = col('Fecha inicio')
  const fFin    = col('Fecha fin')
  const fNotas       = col('Notas')
  const fDesarrollo  = col('Desarrollo') || col('Development') || ''
  const fFase        = col('Fase') || col('Phase') || ''
  const fCapex       = col('CAPEX') || col('Capex') || col('capex') || ''
  const fNombreEN    = col('Nombre EN') || col('Nombre_EN') || col('English Name') || col('Name EN') || ''
  return t.rows
    .filter(r => fNombre && r[fNombre]?.trim())
    .map(r => ({
      id:          uid(),
      nombre:      r[fNombre]             || '',
      descripcion: fDesc  ? r[fDesc]  || '' : '',
      estado:      fEstado? r[fEstado]|| 'No iniciado' : 'No iniciado',
      status:      mapSt(fEstado ? r[fEstado] || '' : ''),
      prioridad:   fPrio  ? r[fPrio]  || '' : '',
      risk:        mapRisk(fPrio ? r[fPrio] || '' : ''),
      propietario: fProp  ? r[fProp]  || '' : '',
      fechaInicio: parseFecha(fIni ? r[fIni] || '' : ''),
      fechaFin:    parseFecha(fFin ? r[fFin] || '' : ''),
      notas:       fNotas ? r[fNotas] || '' : '',
      desarrollo:  fDesarrollo && r[fDesarrollo] ? r[fDesarrollo].trim() : '',
      fase:        fFase       && r[fFase]       ? r[fFase].trim()       : '',
      capex:       fCapex && r[fCapex] ? (parseFloat(String(r[fCapex]).replace(/[^0-9.]/g,''))||null) : null,
      nombreEN:    fNombreEN  && r[fNombreEN]  ? r[fNombreEN].trim()  : '',
    }))
}

export function buildItems(tables) {
  const temasT = tables.find(t =>
    t.heads.includes('Objetivo') &&
    t.heads.includes('Prioridad') &&
    t.heads.includes('Notas')
  )
  const subT = tables.find(t =>
    t.heads.includes('Subtarea') &&
    t.heads.includes('Tema padre')
  )
  if (!temasT) return []

  const subMap = {}
  if (subT) {
    for (const st of subT.rows) {
      const k = norm(st['Tema padre'] || '')
      if (!subMap[k]) subMap[k] = []
      subMap[k].push({
        id:       st['ID'] || uid(),
        title:    st['Subtarea'] || '',
        prop:     st['Propietario'] || '',
        status:   mapSt(st['Estado'] || ''),
        risk:     mapRisk(st['Prioridad'] || ''),
        fechaFin: parseFecha(st['Fecha de finalización'] || ''),
        notas:    st['Notas'] || '',
      })
    }
  }

  return temasT.rows
    .filter(r => r['Tema'] && r['Tema'].trim())
    .map(r => {
      const tema = r['Tema'] || ''
      const k = norm(tema)
      return {
        id:          uid(),
        tema,
        objetivo:    r['Objetivo'] || '',
        prioridad:   r['Prioridad'] || '',
        propietario: r['Propietario'] || '',
        status:      mapSt(r['Estado'] || ''),
        estadoSheet: r['Estado'] || '',
        risk:        mapRisk(r['Prioridad'] || ''),
        category:    inferCat(tema, r['Objetivo'] || ''),
        fechaInicio: parseFecha(r['Fecha de inicio'] || ''),
        fechaFin:    parseFecha(r['Fecha de finalización'] || ''),
        archivos:    r['Archivos relacionados'] || '',
        notas:       r['Notas'] || '',
        proyecto:    r['Proyecto'] || '',
        subtareas:   subMap[k] || [],
      }
    })
}
