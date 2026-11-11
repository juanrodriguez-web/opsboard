// Data access layer. Components must not import the Supabase client directly: add functions here instead.
// Today it talks to the legacy tables (items, proyectos, hitos, comentarios, campanas, plan_accion).
// The F1 cutover swaps the implementation in this folder only.
import { listItems } from './items.js'
import { listProyectos } from './proyectos.js'
import { listCampanas } from './misc.js'

export { uid } from './util.js'
export { dbToItem, itemToDb, dbToProy } from './mappers.js'
export * from './items.js'
export * from './proyectos.js'
export * from './misc.js'

export async function loadAll() {
  const [items, proyectos, campanas] = await Promise.all([listItems(), listProyectos(), listCampanas()])
  return { items, proyectos, campanas }
}
