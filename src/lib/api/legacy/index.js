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
export const legacyApi = { ...items, ...proyectos, ...misc, findPersonByEmail, listSavedViews, saveSavedView, deleteSavedView, listRelations, addRelation, removeRelation }
