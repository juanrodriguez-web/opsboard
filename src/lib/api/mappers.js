import { mapSt } from '../../parser.js'

// DB (snake_case) <-> app (camelCase) mapping for the legacy tables `items` and `proyectos`.
export function dbToItem(row) {
  return {
    ...row,
    estadoSheet: row.estado_sheet || 'No iniciado',
    fechaInicio: row.fecha_inicio ? new Date(row.fecha_inicio) : null,
    fechaFin:    row.fecha_fin    ? new Date(row.fecha_fin)    : null,
    subtareas:   Array.isArray(row.subtareas) ? row.subtareas : [],
  }
}

export function itemToDb(item) {
  return {
    id:           item.id,
    tema:         item.tema || '',
    objetivo:     item.objetivo || '',
    category:     item.category || 'projects',
    propietario:  item.propietario || '',
    prioridad:    item.prioridad || '',
    risk:         item.risk || 'green',
    status:       item.status || 'pending',
    estado_sheet: item.estadoSheet || 'No iniciado',
    fecha_inicio: item.fechaInicio instanceof Date ? item.fechaInicio.toISOString() : (item.fechaInicio || null),
    fecha_fin:    item.fechaFin    instanceof Date ? item.fechaFin.toISOString()    : (item.fechaFin    || null),
    archivos:     item.archivos || '',
    notas:        item.notas || '',
    proyecto:     item.proyecto || '',
    subtareas:    item.subtareas || [],
  }
}

export function dbToProy(row) {
  return {
    ...row,
    status:      row.status || mapSt(row.estado || ''),
    fechaInicio: row.fecha_inicio ? new Date(row.fecha_inicio) : null,
    fechaFin:    row.fecha_fin    ? new Date(row.fecha_fin)    : null,
    fase:        row.fase        || '',
    capex:       row.capex       ?? null,
    nombreEN:    row.nombre_en   || '',
  }
}

// Partial app-level item update -> DB column patch (only defined fields).
export function itemPatchToDb(fields) {
  const db = {}
  const date = v => (v instanceof Date ? v.toISOString() : v)
  if (fields.status       !== undefined) db.status       = fields.status
  if (fields.estadoSheet  !== undefined) db.estado_sheet = fields.estadoSheet
  if (fields.propietario  !== undefined) db.propietario  = fields.propietario
  if (fields.prioridad    !== undefined) db.prioridad    = fields.prioridad
  if (fields.risk         !== undefined) db.risk         = fields.risk
  if (fields.fechaFin     !== undefined) db.fecha_fin    = date(fields.fechaFin)
  if (fields.fechaInicio  !== undefined) db.fecha_inicio = date(fields.fechaInicio)
  if (fields.notas        !== undefined) db.notas        = fields.notas
  if (fields.objetivo     !== undefined) db.objetivo     = fields.objetivo
  if (fields.tema         !== undefined) db.tema         = fields.tema
  if (fields.category     !== undefined) db.category     = fields.category
  if (fields.proyecto     !== undefined) db.proyecto     = fields.proyecto
  if (fields.subtareas    !== undefined) db.subtareas    = fields.subtareas
  return db
}
