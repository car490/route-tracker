// Pure view logic for the Announcement Clips page (docs/ANNOUNCE-VOICE-PLAN.md
// step 5). Shapes what announcement_voice_status() returns into what the page
// shows: Ben clips to review, clips already approved, queue items needing
// attention, and today's ElevenLabs credit use against the daily cap.

// Same fallback as the drain (supabase/functions/_shared/announce-voice/dailyCap.mjs).
const DEFAULT_DAILY_CHAR_CAP = 6000
const MAX_JOB_ATTEMPTS = 3

export function buildReviewView(status) {
  const clips = status?.clips ?? []
  const usage = status?.usage ?? {}
  const parsedCap = Number(usage.cap)
  const cap = usage.cap === null || usage.cap === undefined || usage.cap === '' || !Number.isInteger(parsedCap) || parsedCap < 0
    ? DEFAULT_DAILY_CHAR_CAP
    : parsedCap
  const todayChars = Number(usage.today_chars) || 0
  return {
    voice: status?.voice ?? null,
    toReview: clips.filter((c) => !c.reviewed),
    approved: clips.filter((c) => c.reviewed),
    attention: (status?.attention ?? []).map((a) => ({ ...a, kind: attentionKind(a) })),
    usage: {
      todayChars,
      monthChars: Number(usage.month_chars) || 0,
      cap,
      percent: cap > 0 ? Math.min(100, Math.round((todayChars / cap) * 100)) : 100,
      paused: cap === 0,
    },
  }
}

// Why a queue item is listed under "Needs attention".
//   stale    - a Ben clip's wording changed but this environment's voice isn't Ben
//   capped   - waiting for tomorrow's credit allowance
//   failed   - gave up after the retry limit (e.g. a bad key, or it couldn't be levelled)
//   retrying - failed once or twice; the drain will try again
export function attentionKind(item) {
  const error = item?.last_error ?? ''
  if (error.startsWith('Ben clip is out of date')) return 'stale'
  if (error.startsWith('daily ElevenLabs character cap')) return 'capped'
  if ((item?.attempts ?? 0) >= MAX_JOB_ATTEMPTS) return 'failed'
  return 'retrying'
}

export const ATTENTION_LABEL = {
  stale: 'Out of date',
  capped: 'Waiting for credits',
  failed: 'Failed',
  retrying: 'Retrying',
}

// Public Storage URL for a clip. ?v=<hash> makes the browser fetch a
// re-rendered clip instead of replaying a cached older version.
export function clipAudioUrl(supabaseUrl, storagePath, hash) {
  const path = String(storagePath).split('/').map(encodeURIComponent).join('/')
  return `${supabaseUrl}/storage/v1/object/public/announcement-audio/${path}?v=${encodeURIComponent(hash)}`
}

export function voiceLabel(voice) {
  if (typeof voice === 'string' && voice.startsWith('elevenlabs:')) return 'Ben (ElevenLabs)'
  return `Azure (${voice || 'en-GB-RyanNeural'})`
}
