import { authenticate } from './_auth.js'

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// The emailed link must point at one of our own PWA origins (mirrors PWA_BASE in
// src/shared/supabase.js). Otherwise any signed-in user could have this endpoint
// send a phishing link to a driver from the company's own Resend sender domain.
// localhost is only accepted outside production.
const ALLOWED_DUTY_ORIGINS = [
  'https://driver.pcvtechnologies.co.uk',
  'https://driver-dev.pcvtechnologies.co.uk',
]
function isAllowedDutyUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return false }
  if (ALLOWED_DUTY_ORIGINS.includes(u.origin)) return true
  const isProd = process.env.VERCEL_ENV === 'production'
  return !isProd && u.origin === 'http://localhost:8080'
}

// company_name goes into the From display name: reject anything that could
// break out of it (header injection, angle brackets, quotes) or is absurdly long.
function safeCompanyName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (!name || name.length > 80 || /[\r\n<>"]/.test(name)) return null
  return name
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticate(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { supabase } = auth

  const { driver_id, date, url, company_name } = req.body ?? {}
  if (!driver_id || !date || !url)
    return res.status(400).json({ error: 'driver_id, date, url required' })
  if (!isAllowedDutyUrl(url))
    return res.status(400).json({ error: 'url must be a CoachMate driver link' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })

  const { data: driver } = await supabase.from('employees').select('id, name').eq('id', driver_id).maybeSingle()
  if (!driver) return res.status(403).json({ error: 'driver_id is not accessible' })

  const { data: contact } = await supabase.from('employee_contacts')
    .select('value').eq('employee_id', driver_id).eq('type', 'email')
    .order('is_primary', { ascending: false }).limit(1).maybeSingle()
  if (!contact) return res.status(400).json({ error: 'No email address on file for this driver' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' })

  const from = process.env.RESEND_FROM
  if (!from) return res.status(500).json({ error: 'RESEND_FROM not configured' })

  const longDate = fmtLongDate(date)
  const companyName = safeCompanyName(company_name)
  const fromField = companyName ? `${companyName} <${from}>` : from
  const sender = companyName ?? 'CoachMate'
  const to = contact.value
  const driverName = driver.name
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromField,
      to,
      subject: `Your Duty Card — ${longDate}`,
      html: `<p>Hi ${escapeHtml(driverName)},</p><p>Your duty card for ${longDate} is ready.</p><p><a href="${escapeHtml(url)}">View Duty Card →</a></p><p>${escapeHtml(sender)}</p>`,
      text: `Hi ${driverName},\n\nYour duty card for ${longDate} is ready.\n\nView Duty Card: ${url}\n\n${sender}`,
    }),
  })

  const data = await r.json()
  if (!r.ok) return res.status(r.status).json({ error: data.message ?? 'Email send failed' })
  return res.json({ ok: true })
}
