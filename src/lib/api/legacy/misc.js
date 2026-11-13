import { supabase } from '../../supabase.js'

// Campaigns: a failure is non-fatal (table may be empty), matching the previous behaviour.
export async function listCampanas() {
  const { data } = await supabase.from('campanas').select('*').order('created_at', { ascending: false })
  return data || []
}

// Plan de Acción (read-only screen). Kept on the legacy table; not part of the F1 model.
export async function listPlanAccion() {
  const { data } = await supabase.from('plan_accion').select('*').order('seccion')
  return data || []
}
