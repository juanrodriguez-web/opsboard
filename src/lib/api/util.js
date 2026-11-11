export const uid = () => Math.random().toString(36).slice(2, 9)

// supabase-js returns { data, error } instead of throwing; the data layer throws so callers can try/catch.
export function unwrap({ data, error }, label) {
  if (error) throw new Error(label ? `${label}: ${error.message}` : error.message)
  return data
}
