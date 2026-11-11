// Synthetic captures (three browser sources) exercising every F1C path.
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003'
const ORIGIN = 'https://opsboard.example'
const blank = { descripcion: '', propietario: '', fechaInicio: '', fechaFin: '', prioridad: '', status: 'pending', desarrollo: '', fase: '', capex: null, nombreEN: '' }
const ov = o => ({ ...blank, ...o })
const cap = (source_id, source_label, captured_at, kv, n = 1) => ({
  format: 'opsboard-localstorage-capture', version: 1, capture_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  source_id, source_label, origin: ORIGIN, captured_at,
  entries: Object.entries(kv).map(([storage_key, v]) => ({ storage_key, raw_payload: typeof v === 'string' ? v : JSON.stringify(v) })), ignored_keys: ['obs-dash-own'] })

const cm = (id, k, iso, text) => ({ k, ts: '01/05 10:00', text, id, iso })
const aOverrides = {
  'bonos prepago': ov({ descripcion: 'Desc A', propietario: 'Juan Rodriguez Peisel', fechaInicio: '2026-03-01', prioridad: 'P1', status: 'inprogress', fase: 'RTM', capex: 1000 }),
  'gamificacion': ov({ descripcion: 'Desc DB', prioridad: 'P2', capex: 500 }),
  'tab\tname': ov({ descripcion: 'Tab desc' }),
  'proyecto inexistente': ov({ descripcion: 'huerfano' }),
  'otro proyecto': ov({ prioridad: 'P0', fechaInicio: '2026-01-11', status: 'inprogress', fase: 'RTM' }),
  'sensible vaciada': ov({ descripcion: 'Local desc' }),
}
const aKV = {
  'obs-proy-overrides': aOverrides,
  'obs-comments': [cm('c1', 'tema uno', '2026-05-01T10:00:00.000Z', 'Primer comentario'), cm('c2', 'tema tres', '2026-05-02T10:00:00.000Z', 'Sobre tres'),
                   cm('c3', 'duplicado', '2026-05-03T10:00:00.000Z', 'Ambiguo'), cm('c4', 'tema cuatro antiguo', '2026-05-04T10:00:00.000Z', 'Huerfano'),
                   cm('c5', 'held owner', '2026-05-05T10:00:00.000Z', 'Item retenido')],
  'obs-proj-comments': [cm('pc1', 'bonos prepago', '2026-05-06T10:00:00.000Z', 'Coment proyecto'), cm('pc2', 'proyecto zzz', '2026-05-07T10:00:00.000Z', 'Proyecto raro')],
  'obs-done-ts-i1': '1700000000000', 'obs-done-ts-i4': '1700000000000', 'obs-done-ts-i5': '1700000123456',
  'obs-status-overrides': '{}',
}
const bBase = {
  'obs-proy-overrides': {
    'bonos prepago': ov({ descripcion: 'Desc A', propietario: 'Francisco Toledo', fechaInicio: '2026-03-01', prioridad: 'P3', status: 'inprogress', fase: 'RTM', capex: 1000 }),
    'gamificacion': ov({ descripcion: 'Desc DB', prioridad: 'P2', capex: 500 }),
    'otro proyecto': ov({ prioridad: 'P0', fechaInicio: '2026-01-11', status: 'inprogress', fase: 'RTM' }),
    'nombre  doble': ov({ descripcion: 'Doble' }),
  },
  'obs-comments': [cm('zz9', 'tema uno', '2026-05-01T10:00:00.000Z', 'Primer comentario'), cm('b1', 'tema dos', '2026-05-08T10:00:00.000Z', 'Solo en B')],
}
export const captures = [
  cap(A, 'Chrome A', '2026-09-20T10:00:00Z', aKV, 1),
  cap(B, 'Chrome B', '2026-09-10T10:00:00Z', bBase, 2),                                                    // older B state: prioridad P3
  cap(B, 'Chrome B', '2026-09-21T10:00:00Z', { ...bBase, 'obs-proy-overrides': { ...bBase['obs-proy-overrides'],
        'bonos prepago': ov({ descripcion: 'Desc A', propietario: 'Francisco Toledo', fechaInicio: '2026-03-01', prioridad: 'P0', status: 'inprogress', fase: 'RTM', capex: 1000 }) } }, 3), // latest B: P0
  cap(C, 'Firefox', '2026-09-22T10:00:00Z', aKV, 4),                                                       // identical content to A, other browser
]
export const SOURCES = { A, B, C }
