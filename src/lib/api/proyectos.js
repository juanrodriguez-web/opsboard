import { supabase } from '../supabase.js'
import { unwrap } from './util.js'
import { dbToProy } from './mappers.js'

export async function listProyectos() {
  const rows = unwrap(await supabase.from('proyectos').select('*').order('created_at', { ascending: false }), 'proyectos')
  return (rows || []).map(dbToProy)
}

// `fields` are DB columns (snake_case), as before.
export async function updateProyecto(id, fields) {
  unwrap(await supabase.from('proyectos').update(fields).eq('id', id))
}

export async function insertProyectoRows(rows) {
  unwrap(await supabase.from('proyectos').insert(rows), 'proyectos')
}

// Milestones
export async function listHitos(proyectoId) {
  return unwrap(await supabase.from('hitos').select('*').eq('proyecto_id', proyectoId).order('orden', { ascending: true })) || []
}
export async function addHito(row) {
  const data = unwrap(await supabase.from('hitos').insert(row).select())
  return data?.[0]
}
export async function updateHito(id, fields) {
  unwrap(await supabase.from('hitos').update(fields).eq('id', id))
}
export async function deleteHito(id) {
  unwrap(await supabase.from('hitos').delete().eq('id', id))
}

// Project comments.
// NOTE (existing behaviour, kept): `.eq('item_id', null)` produces `item_id=eq.null`, which never matches a NULL column,
// so previously saved project comments are not returned. Should be `.is('item_id', null)`; left as-is on purpose
// because this change must not alter behaviour.
export async function listProyectoComments(proyectoId) {
  return unwrap(await supabase.from('comentarios').select('*').eq('proyecto_id', proyectoId).eq('item_id', null).order('created_at', { ascending: false })) || []
}
export async function addProyectoComment(row) {
  const data = unwrap(await supabase.from('comentarios').insert(row).select())
  return data?.[0]
}
