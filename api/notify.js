// POST /api/notify — sends assignment email via Resend
// Env vars required: RESEND_API_KEY

const OWNER_EMAILS = {
  'juan rodriguez peisel': 'juangas50@gmail.com',
  'francisco toledo':      'francisco.toledo@sercomsoluciones.es',
}

// Normalize to lowercase, no accents
const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const findEmail = name => {
  const n = norm(name)
  for (const [key, email] of Object.entries(OWNER_EMAILS)) {
    if (n.includes(key) || key.includes(n)) return email
  }
  return null
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { tema, propietario, descripcion = '', categoria = '', prioridad = '' } = req.body || {}

  if (!tema || !propietario) {
    return res.status(400).json({ error: 'Missing tema or propietario' })
  }

  const to = findEmail(propietario)
  if (!to) {
    // Not one of the monitored users — skip silently
    return res.status(200).json({ skipped: true, reason: 'owner not monitored' })
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('[notify] RESEND_API_KEY not set — email skipped')
    return res.status(200).json({ skipped: true, reason: 'no api key' })
  }

  const prioBadge = prioridad ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">${prioridad}</span>` : ''
  const catLine   = categoria ? `<p style="margin:0 0 4px;font-size:13px;color:#6b7280">Categoría: <strong>${categoria}</strong></p>` : ''
  const descLine  = descripcion ? `<p style="margin:12px 0 0;font-size:14px;color:#374151;line-height:1.6">${descripcion}</p>` : ''

  const html = `
    <div style="font-family:'Geist',system-ui,sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#e8243b,#c4001a);padding:20px 24px">
        <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.02em">⬡ OpsBoard</div>
        <div style="font-size:13px;color:#fca5a5;margin-top:2px">Nueva tarea asignada</div>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Se te ha asignado</p>
        <h2 style="margin:0 0 10px;font-size:18px;font-weight:700;color:#111827;line-height:1.3">${tema}</h2>
        ${catLine}
        ${prioBadge}
        ${descLine}
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0">
        <p style="margin:0;font-size:12px;color:#9ca3af">Este mensaje fue generado automáticamente por OpsBoard.</p>
      </div>
    </div>
  `

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'OpsBoard <onboarding@resend.dev>',
        to:      [to],
        subject: `📋 Tarea asignada: ${tema}`,
        html,
      }),
    })

    const data = await resp.json()
    if (!resp.ok) {
      console.error('[notify] Resend error:', data)
      return res.status(502).json({ error: data })
    }

    console.log(`[notify] Email sent to ${to} for tema: ${tema}`)
    res.status(200).json({ ok: true, to })
  } catch (err) {
    console.error('[notify] fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
