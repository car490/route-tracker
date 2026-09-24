// Announcement Clips: review Ben (ElevenLabs) announcement clips after they
// start playing (docs/ANNOUNCE-VOICE-PLAN.md step 5). Ops managers and super
// users only; the database functions enforce that, this page just explains it.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { buildReviewView, clipAudioUrl, voiceLabel, ATTENTION_LABEL } from './clipReview'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ATTENTION_BADGE = { stale: 'badge-red', failed: 'badge-red', capped: 'badge-amber', retrying: 'badge-gray' }

function when(ts) {
  return ts ? new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function ClipRow({ clip, onApprove, approving }) {
  return (
    <tr>
      <td>
        <div>{clip.text}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>{clip.key}</div>
      </td>
      <td>
        <audio controls preload="none" src={clipAudioUrl(SUPABASE_URL, clip.storage_path, clip.hash)}
               aria-label={`Play: ${clip.text}`} style={{ height: 32 }} />
      </td>
      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {clip.loudness_lufs != null ? `${Number(clip.loudness_lufs).toFixed(1)} LUFS` : '—'}
      </td>
      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{when(clip.rendered_at)}</td>
      <td>
        {clip.reviewed ? (
          <span className="badge badge-green">Approved by {clip.reviewed_by}, {when(clip.reviewed_at)}</span>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => onApprove(clip)} disabled={approving}>
            Approve
          </button>
        )}
      </td>
    </tr>
  )
}

function ClipTable({ clips, onApprove, approving, empty }) {
  if (clips.length === 0) return <div className="empty-state">{empty}</div>
  return (
    <table>
      <thead>
        <tr><th>Announcement</th><th>Listen</th><th>Loudness</th><th>Made</th><th></th></tr>
      </thead>
      <tbody>
        {clips.map((c) => <ClipRow key={c.key} clip={c} onApprove={onApprove} approving={approving === c.key} />)}
      </tbody>
    </table>
  )
}

export default function AnnouncementClipsPage() {
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  const [approving, setApproving] = useState(null)
  const [showApproved, setShowApproved] = useState(false)

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('announcement_voice_status')
    if (rpcError) { setError(rpcError.message); setView(null); return }
    setError('')
    setView(buildReviewView(data))
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(clip) {
    setApproving(clip.key)
    const { error: rpcError } = await supabase.rpc('review_announcement_clip', { p_key: clip.key, p_hash: clip.hash })
    setApproving(null)
    if (rpcError) setError(rpcError.message)
    await load()
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Announcement Clips</h1>
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      {error && <div className="error-msg" role="alert">{error}</div>}
      {!view && !error && <div className="empty-state">Loading…</div>}

      {view && (
        <>
          <div className="card" style={{ marginBottom: 16, padding: 20 }}>
            <div>Voice for new clips: <strong>{voiceLabel(view.voice)}</strong></div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="credit-use">
                ElevenLabs characters used today: <strong>{view.usage.todayChars.toLocaleString('en-GB')}</strong>
                {' of '}{view.usage.cap.toLocaleString('en-GB')} daily limit
                {' · '}this month: {view.usage.monthChars.toLocaleString('en-GB')}
              </label>
              <progress id="credit-use" max={100} value={view.usage.percent}
                        style={{ display: 'block', width: '100%', marginTop: 6 }}>
                {view.usage.percent}%
              </progress>
              {view.usage.paused && <div style={{ marginTop: 6 }}><span className="badge badge-amber">Paused: the daily limit is set to 0</span></div>}
            </div>
          </div>

          {view.attention.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">Needs attention ({view.attention.length})</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Status</th><th>Announcement</th><th>Reason</th><th>Last tried</th></tr></thead>
                  <tbody>
                    {view.attention.map((a) => (
                      <tr key={`${a.key}-${a.last_attempt_at}`}>
                        <td><span className={`badge ${ATTENTION_BADGE[a.kind]}`}>{ATTENTION_LABEL[a.kind]}</span></td>
                        <td>{a.text}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{a.last_error}</td>
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{when(a.last_attempt_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">To review ({view.toReview.length})</div>
            <div className="table-wrap">
              <ClipTable clips={view.toReview} onApprove={approve} approving={approving}
                         empty="Nothing to review. New Ben clips appear here as soon as they're made." />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowApproved((s) => !s)} aria-expanded={showApproved}>
                {showApproved ? 'Hide' : 'Show'} approved clips ({view.approved.length})
              </button>
            </div>
            {showApproved && (
              <div className="table-wrap">
                <ClipTable clips={view.approved} onApprove={approve} approving={approving} empty="No approved clips yet." />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
