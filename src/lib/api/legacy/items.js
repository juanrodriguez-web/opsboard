import { supabase } from '../../supabase.js'
import { unwrap } from '../util.js'
import { dbToItem, itemToDb, itemPatchToDb } from './mappers.js'

export async function listItems() {
  const rows = unwrap(await supabase.from('items').select('*').order('created_at', { ascending: false }), 'items')
  return (rows || []).map(dbToItem)
}

export async function insertItems(items) {
  unwrap(await supabase.from('items').insert(items.map(itemToDb)))
}

// App-level partial patch (camelCase). No-op when nothing maps to a DB column.
export async function updateItem(id, fields) {
  const patch = itemPatchToDb(fields)
  if (!Object.keys(patch).length) return
  unwrap(await supabase.from('items').update(patch).eq('id', id))
}

export async function deleteItem(id) {
  unwrap(await supabase.from('items').delete().eq('id', id))
}

// Merge two items: update the destination, delete the old one.
export async function mergeItems({ keepId, removeId, tema, notas }) {
  unwrap(await supabase.from('items').update({ tema, notas }).eq('id', keepId))
  unwrap(await supabase.from('items').delete().eq('id', removeId))
}

// Real-time changes of `items`. Returns an unsubscribe function.
export function subscribeToItems({ onInsert, onUpdate, onDelete }) {
  const channel = supabase
    .channel('items-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, payload => {
      if (payload.eventType === 'INSERT') onInsert?.(dbToItem(payload.new))
      else if (payload.eventType === 'UPDATE') onUpdate?.(dbToItem(payload.new))
      else if (payload.eventType === 'DELETE') onDelete?.(payload.old.id)
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}
