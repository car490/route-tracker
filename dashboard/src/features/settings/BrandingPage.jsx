import { useState, useEffect } from 'react'
import { supabase } from '../../shared/supabase'
import { useCurrentEmployee } from '../../shared/hooks/useCurrentEmployee'

const BUCKET = 'operator-assets'
const CM_PRIMARY = '#242F35'
const CM_ACCENT  = '#00B4D8'

/** Only allow https: and blob: URL schemes for image src attributes to prevent javascript: injection. */
function safeSrc(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'blob:') return parsed.href
  } catch {
    // Not a valid URL — reject
  }
  return null
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function ColorSwatch({ label, value, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: 44,
            height: 36,
            padding: 2,
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
            background: 'var(--surface)',
          }}
        />
        <input
          type="text"
          className="form-input"
          style={{ flex: 1 }}
          value={value}
          maxLength={7}
          pattern="#[0-9a-fA-F]{6}"
          onChange={e => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Reset to CoachMate default"
          onClick={() => onChange(label.toLowerCase().includes('primary') ? CM_PRIMARY : CM_ACCENT)}
          style={{ whiteSpace: 'nowrap' }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

export default function BrandingPage({ session }) {
  const employee = useCurrentEmployee(session?.user?.id)
  const isSuperUser = employee?.access_level === 'super_user'

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const [success,  setSuccess]  = useState(false)

  const [primary,  setPrimary]  = useState(CM_PRIMARY)
  const [accent,   setAccent]   = useState(CM_ACCENT)
  const [slug,     setSlug]     = useState('')
  const [logoPath, setLogoPath] = useState(null)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)

  // Derived live preview colours
  const previewPrimary = primary.length === 7 ? primary : CM_PRIMARY
  const previewAccent  = accent.length  === 7 ? accent  : CM_ACCENT

  useEffect(() => {
    if (!employee?.company_id) return
    supabase
      .from('companies')
      .select('name, slug, primary_color, accent_color, logo_path')
      .eq('id', employee.company_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setPrimary(data.primary_color ?? CM_PRIMARY)
          setAccent(data.accent_color   ?? CM_ACCENT)
          setSlug(data.slug ?? slugify(data.name ?? ''))
          setLogoPath(data.logo_path ?? null)
        }
        setLoading(false)
      })
  }, [employee?.company_id])

  const logoUrl = safeSrc(
    logoPreview
      ?? (logoPath ? supabase.storage.from(BUCKET).getPublicUrl(logoPath).data.publicUrl : null)
  )

  function handleLogoChange(e) {
    const f = e.target.files[0]
    if (!f) return
    setLogoFile(f)
    setLogoPreview(URL.createObjectURL(f))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!employee?.company_id) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    let newLogoPath = logoPath

    // Upload logo if a new file was selected
    if (logoFile) {
      const ext = logoFile.name.split('.').pop().toLowerCase()
      const uploadPath = `${employee.company_id}/logo.${ext}`

      // Remove old logo if extension changed
      if (logoPath && logoPath !== uploadPath) {
        await supabase.storage.from(BUCKET).remove([logoPath])
      }

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(uploadPath, logoFile, { upsert: true, contentType: logoFile.type })

      if (uploadErr) {
        setError(`Logo upload failed: ${uploadErr.message}`)
        setSaving(false)
        return
      }
      newLogoPath = uploadPath
    }

    const { error: updateErr } = await supabase
      .from('companies')
      .update({
        slug:          slug.trim() || null,
        primary_color: primary,
        accent_color:  accent,
        logo_path:     newLogoPath,
      })
      .eq('id', employee.company_id)

    if (updateErr) {
      setError(updateErr.message)
      setSaving(false)
      return
    }

    // Push updated colours into CSS immediately
    document.documentElement.style.setProperty('--operator-primary', primary)
    document.documentElement.style.setProperty('--operator-accent',  accent)
    if (newLogoPath !== logoPath) setLogoPath(newLogoPath)
    setLogoFile(null)
    setSaving(false)
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
  }

  if (!isSuperUser) {
    return (
      <div className="empty-state">
        Only super users can manage branding.
      </div>
    )
  }

  if (loading) return <div className="empty-state">Loading…</div>

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1 className="page-title">Branding</h1>
      </div>

      {/* Live preview strip */}
      <div
        className="card"
        style={{ marginBottom: 24, overflow: 'hidden' }}
      >
        <div
          className="card-header"
          style={{ background: previewPrimary, color: '#fff', borderBottom: 'none' }}
        >
          <span style={{ fontWeight: 700 }}>Live Preview</span>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt="Company logo preview"
              style={{ maxHeight: 44, maxWidth: 140, objectFit: 'contain' }}
            />
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: previewAccent }}
          >
            Sample button
          </button>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: previewAccent,
            }}
          />
        </div>
      </div>

      <form onSubmit={handleSave}>
        <div className="card" style={{ padding: '20px', marginBottom: 16 }}>
          <p className="form-section-label">Colours</p>

          <ColorSwatch label="Primary colour (sidebar / header)" value={primary} onChange={setPrimary} />
          <ColorSwatch label="Accent colour (buttons / highlights)" value={accent} onChange={setAccent} />
        </div>

        <div className="card" style={{ padding: '20px', marginBottom: 16 }}>
          <p className="form-section-label">Logo</p>
          <div className="form-group">
            <label className="form-label">Company logo</label>
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Current logo"
                className="logo-modal-preview"
                style={{ marginBottom: 10 }}
              />
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={handleLogoChange}
              style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)' }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              PNG, JPG, SVG or WebP. Displayed in the sidebar.
            </p>
          </div>
        </div>

        <div className="card" style={{ padding: '20px', marginBottom: 24 }}>
          <p className="form-section-label">Slug</p>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">URL slug</label>
            <input
              type="text"
              className="form-input"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g. phil-haines-coaches"
              maxLength={80}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Used in future public tracking pages. Lowercase letters, numbers, and hyphens only.
            </p>
          </div>
        </div>

        {error   && <div className="error-msg">{error}</div>}
        {success && (
          <div style={{ background: '#E6F9F4', color: '#0D9268', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            Branding saved.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </div>
      </form>
    </div>
  )
}
