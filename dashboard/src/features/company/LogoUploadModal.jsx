import { useState } from 'react'
import { supabase } from '../../shared/supabase'

const BUCKET = 'company-logos'

export default function LogoUploadModal({ companyId, currentLogoPath, onClose, onSaved }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const currentUrl = currentLogoPath
    ? supabase.storage.from(BUCKET).getPublicUrl(currentLogoPath).data.publicUrl
    : null

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function handleUpload() {
    if (!file) return
    setSaving(true)
    setError(null)

    const ext = file.name.split('.').pop().toLowerCase()
    const newPath = `${companyId}/logo.${ext}`

    // Remove old file if the extension has changed (avoids orphaned objects)
    if (currentLogoPath && currentLogoPath !== newPath) {
      await supabase.storage.from(BUCKET).remove([currentLogoPath])
    }

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, file, { upsert: true, contentType: file.type })

    if (uploadErr) { setError(uploadErr.message); setSaving(false); return }

    const { error: updateErr } = await supabase
      .from('companies')
      .update({ logo_path: newPath })
      .eq('id', companyId)

    if (updateErr) { setError(updateErr.message); setSaving(false); return }

    setSaving(false)
    onSaved(newPath)
  }

  async function handleDelete() {
    if (!currentLogoPath) return
    setSaving(true)
    setError(null)

    const { error: removeErr } = await supabase.storage.from(BUCKET).remove([currentLogoPath])
    if (removeErr) { setError(removeErr.message); setSaving(false); return }

    const { error: updateErr } = await supabase
      .from('companies')
      .update({ logo_path: null })
      .eq('id', companyId)

    if (updateErr) { setError(updateErr.message); setSaving(false); return }

    setSaving(false)
    onSaved(null)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">Company Logo</div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}

          {currentUrl && !preview && (
            <div className="form-group">
              <div className="form-label">Current logo</div>
              <img src={currentUrl} alt="Current logo" className="logo-modal-preview" />
            </div>
          )}

          {preview && (
            <div className="form-group">
              <div className="form-label">Preview</div>
              <img src={preview} alt="New logo preview" className="logo-modal-preview" />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">
              {currentUrl ? 'Replace image' : 'Upload image'}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="form-input"
            />
          </div>
        </div>
        <div className="modal-footer">
          {currentLogoPath && !preview && (
            <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={saving}>
              Remove logo
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleUpload}
            disabled={!file || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
