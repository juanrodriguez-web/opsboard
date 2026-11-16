// Legacy backend: the tables used today (items, proyectos, hitos, comentarios, campanas, plan_accion).
import * as items from './items.js'
import * as proyectos from './proyectos.js'
import * as misc from './misc.js'

// Identification by e-mail only exists in the PM model (people.email).
const findPersonByEmail = async () => null
const listSavedViews = async () => { throw new Error('Saved views need the PM backend') }
const saveSavedView = listSavedViews
const deleteSavedView = listSavedViews

const listRelations = async () => []
const addRelation = async () => { throw new Error('Las dependencias necesitan el backend PM') }
const removeRelation = addRelation
const getChecklist = async () => ({ id: null, items: [] })
const addChecklistItem = async () => { throw new Error('Las checklists necesitan el backend PM') }
const updateChecklistItem = addChecklistItem, deleteChecklistItem = addChecklistItem
const listChecklistProgress = async () => ({})
const listMailCandidates = async () => []
const insertMailCandidates = async () => { throw new Error('Backlog Mail necesita el backend PM') }
const decideMailCandidate = insertMailCandidates
const listPeople = async () => []
const listItemComments = async () => []
const addItemComment = async () => { throw new Error('Los comentarios necesitan el backend PM') }
const importItemComments = async () => ({ inserted: 0, skipped: 0, failed: 0 })
const deleteProyecto = async () => { throw new Error('Borrar proyectos necesita el backend PM') }
const updatePersonCapacity = async () => { throw new Error('La capacidad necesita el backend PM') }
export const legacyApi = { ...items, ...proyectos, ...misc, findPersonByEmail, listSavedViews, saveSavedView, deleteSavedView, listRelations, addRelation, removeRelation, getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, listChecklistProgress, listPeople, updatePersonCapacity, listMailCandidates, insertMailCandidates, decideMailCandidate, listItemComments, addItemComment, importItemComments, deleteProyecto }
