function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers['authorization']
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  const { to, driver_name, date, url, company_name } = req.body ?? {}
  if (!to || !driver_name || !date || !url)
    return res.status(400).json({ error: 'to, driver_name, date, url required' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' })

  const from = process.env.RESEND_FROM
  if (!from) return res.status(500).json({ error: 'RESEND_FROM not configured' })

  const longDate = fmtLongDate(date)
  const fromField = company_name ? `${company_name} <${from}>` : from
  const sender = company_name ?? 'RouteTracker'
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromField,
      to,
      subject: `Your Duty Card — ${longDate}`,
      html: `<p>Hi ${driver_name},</p><p>Your duty card for ${longDate} is ready.</p><p><a href="${url}">View Duty Card →</a></p><p>${sender}</p>`,
      text: `Hi ${driver_name},\n\nYour duty card for ${longDate} is ready.\n\nView Duty Card: ${url}\n\n${sender}`,
    }),
  })

  const data = await r.json()
  if (!r.ok) return res.status(r.status).json({ error: data.message ?? 'Email send failed' })
  return res.json({ ok: true })
}
