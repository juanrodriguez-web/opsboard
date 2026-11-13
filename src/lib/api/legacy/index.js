// Legacy backend: the tables used today (items, proyectos, hitos, comentarios, campanas, plan_accion).
import * as items from './items.js'
import * as proyectos from './proyectos.js'
import * as misc from './misc.js'

// Identification by e-mail only exists in the PM model (people.email).
const findPersonByEmail = async () => null

export const legacyApi = { ...items, ...proyectos, ...misc, findPersonByEmail }
