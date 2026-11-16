// Data access layer. Components must not import the Supabase client directly: add functions here instead.
//
// Exactly ONE backend is active per build (no dual-write):
//   VITE_DATA_BACKEND unset / 'legacy'  -> legacy tables (items, proyectos, hitos, comentarios)
//   VITE_DATA_BACKEND = 'pm'            -> PM model (work_items, projects, people, statuses, comments)
// campanas and plan_accion always stay on their legacy tables.
import { supabase } from '../supabase.js'
import { legacyApi } from './legacy/index.js'
import { createPmApi } from './pm/index.js'

export { uid } from './util.js'

export const BACKEND = import.meta.env.VITE_DATA_BACKEND === 'pm' ? 'pm' : 'legacy'
const api = BACKEND === 'pm' ? createPmApi(supabase, legacyApi) : legacyApi

export const loadAll = BACKEND === 'pm' ? api.loadAll : async () => {
  const [items, proyectos, campanas] = await Promise.all([api.listItems(), api.listProyectos(), api.listCampanas()])
  return { items, proyectos, campanas, relations: [] }
}
export const {
  insertItems, updateItem, deleteItem, mergeItems, subscribeToItems,
  updateProyecto, insertProyectoRows,
  listHitos, addHito, updateHito, deleteHito, listProyectoComments, addProyectoComment, listItemComments, addItemComment, importItemComments,
  listPlanAccion, listCampanas, findPersonByEmail, listSavedViews, saveSavedView, deleteSavedView,
  listRelations, addRelation, removeRelation,
  getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, listChecklistProgress,
  listPeople, updatePersonCapacity, listMailCandidates, insertMailCandidates, decideMailCandidate,
} = api
