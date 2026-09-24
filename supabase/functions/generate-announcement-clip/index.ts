/**
 * generate-announcement-clip Edge Function
 *
 * Drains public.announcement_clip_jobs (Phase 1 of
 * docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md): renders any genuinely new/changed
 * clip via Azure Neural TTS, uploads it to the announcement-audio Storage
 * bucket, and upserts the manifest row in public.announcement_clips.
 *
 * Called by a pg_cron schedule (see migration_announcement_clip_drain_cron.sql)
 * via pg_net, mirroring naptan-import's existing pattern -- not called
 * directly by any client; announcement_clip_jobs itself has no anon/
 * authenticated grants at all (see migration_announcement_clips.sql), so
 * there'd be nothing for a client-triggered call to drain even if it could
 * reach this function.
 *
 * Required Edge Function secrets (Supabase Dashboard -> Edge Functions -> Secrets):
 *   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION
 *
 * Secured by comparing the caller's Authorization Bearer token against a
 * dedicated CALLER_AUTH_TOKEN Edge Function secret -- deliberately NOT
 * Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') (naptan-import's pattern, which
 * this function originally copied): on this project, the auto-injected
 * SUPABASE_SERVICE_ROLE_KEY has drifted to the newer sb_secret_-format key,
 * while the platform's own verify_jwt gateway check only accepts a
 * legacy-JWT-format bearer token -- confirmed live via a temporary
 * diagnostic log (2026-09-15): tokenPrefix 'eyJhbG' (legacy JWT, from vault,
 * passes the gateway) vs envKeyPrefix 'sb_sec' (new format, what
 * SUPABASE_SERVICE_ROLE_KEY now equals) -- no single credential satisfies
 * both checks simultaneously. CALLER_AUTH_TOKEN is set to the same legacy
 * JWT value stored in the naptan_import_token vault secret, so both the
 * gateway and this function's own check agree.
 *
 * One-time DB setup per environment, if not already done for naptan-import's
 * own token (same vault secret can be reused):
 *   select vault.create_secret('<legacy service_role JWT>', 'naptan_import_token');
 * And set the matching Edge Function secret:
 *   supabase secrets set CALLER_AUTH_TOKEN=<the same legacy service_role JWT>
 *
 * key/text/voice generation happens entirely in the enqueue triggers
 * (fn_announcement_clip_enqueue_on_stop_change/_on_route_change) -- this
 * function only renders whatever a job row already specifies. That's a
 * deliberate departure from this doc's original "import clipKeysFor into
 * the Edge Function" idea: putting key generation in SQL (already covered
 * by supabase/tests/announcement_clips_rls.sql) removes the need to
 * duplicate that logic here too.
 *
 * Hash algorithm must stay identical to scripts/generate-announcement-audio.mjs's
 * hashText() -- sha256(`${voice}|${AUDIO_FORMAT}|${text}`), first 16 hex chars --
 * so a clip this function skips as "unchanged" and one that script would also
 * skip agree, and so clips rendered by either path are comparable. The audio
 * format is in the hash so a quality change re-renders every clip.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEFAULT_BATCH_SIZE = 20
// Highest quality at the neural voices' native 24 kHz. It was audio-16khz-64kbitrate-mono-mp3, Azure's
// lowest MP3 tier (8 kHz of bandwidth), which made the voice sound thin and synthetic on a tablet
// speaker. Azure bills per character, not per format, so this costs nothing at the API; each clip is
// about 2.5x larger. Must equal AUDIO_FORMAT in scripts/generate-announcement-audio.mjs (a Jest test,
// tests/announcementAudioFormat.test.js, fails if they differ). It is part of every clip's hash (see
// hashText), so changing it re-renders every clip instead of every clip being skipped as "unchanged".
const AUDIO_FORMAT = 'audio-24khz-160kbitrate-mono-mp3'

interface ClipJob {
  id: string
  key: string
  text: string
  voice: string
  requested_at: string
}

// Constant-time bearer check: hash both sides to fixed-length digests, then
// compare every byte, so response timing reveals nothing about how much of
// the secret a guess got right (a plain !== returns at the first mismatch).
async function tokenMatches(given: string, expected: string | undefined): Promise<boolean> {
  if (!given || !expected) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a), y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

Deno.serve(async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!(await tokenMatches(token, Deno.env.get('CALLER_AUTH_TOKEN')))) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const batchSize: number = Number.isFinite(body.batch_size) && body.batch_size > 0
    ? Math.min(body.batch_size, 100)
    : DEFAULT_BATCH_SIZE

  try {
    const result = await drain(batchSize)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('generate-announcement-clip failed:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ── Drain logic ─────────────────────────────────────────────────────────────

async function drain(batchSize: number) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const azureKey = Deno.env.get('AZURE_SPEECH_KEY')
  const azureRegion = Deno.env.get('AZURE_SPEECH_REGION')
  if (!azureKey || !azureRegion) {
    throw new Error('AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set as Edge Function secrets')
  }

  const { data: jobs, error: fetchError } = await supabase
    .from('announcement_clip_jobs')
    .select('id, key, text, voice, requested_at')
    .order('requested_at', { ascending: true })
    .limit(batchSize)
  if (fetchError) throw new Error(`Failed to read announcement_clip_jobs: ${fetchError.message}`)
  if (!jobs || jobs.length === 0) {
    return { processed: 0, rendered: 0, skipped: 0, failed: 0, errors: [] }
  }

  // Dedupe by key within this batch -- a key can be enqueued more than once
  // (e.g. two quick edits to the same stop) before a drain runs. Last
  // enqueued wins for the text actually rendered; every job id sharing that
  // key still gets cleared once the key is handled.
  const byKey = new Map<string, { job: ClipJob; jobIds: string[] }>()
  for (const job of jobs as ClipJob[]) {
    const existing = byKey.get(job.key)
    if (existing) {
      existing.jobIds.push(job.id)
      if (job.requested_at > existing.job.requested_at) existing.job = job
    } else {
      byKey.set(job.key, { job, jobIds: [job.id] })
    }
  }

  let rendered = 0, skipped = 0, failed = 0
  const errors: { key: string; message: string }[] = []
  const handledJobIds: string[] = []

  for (const [key, { job, jobIds }] of byKey) {
    try {
      const hash = await hashText(job.voice, job.text)

      const { data: existingClip } = await supabase
        .from('announcement_clips')
        .select('hash')
        .eq('key', key)
        .maybeSingle()

      if (existingClip?.hash === hash) {
        skipped++
        handledJobIds.push(...jobIds)
        continue
      }

      const mp3 = await synthesize(job.text, job.voice, azureKey, azureRegion)
      const storagePath = `${key}.mp3`

      const { error: uploadError } = await supabase.storage
        .from('announcement-audio')
        .upload(storagePath, mp3, { contentType: 'audio/mpeg', upsert: true, cacheControl: '300' })
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

      const { error: upsertError } = await supabase
        .from('announcement_clips')
        .upsert(
          { key, storage_path: storagePath, hash, text: job.text, voice: job.voice, rendered_at: new Date().toISOString() },
          { onConflict: 'key' },
        )
      if (upsertError) throw new Error(`announcement_clips upsert failed: ${upsertError.message}`)

      rendered++
      handledJobIds.push(...jobIds)
    } catch (err) {
      // Deliberately NOT added to handledJobIds -- left in the queue so the
      // next drain cycle retries it, rather than silently losing the job.
      failed++
      errors.push({ key, message: String(err) })
      console.error(`generate-announcement-clip: failed key ${key}:`, err)
    }
  }

  if (handledJobIds.length) {
    const { error: deleteError } = await supabase
      .from('announcement_clip_jobs')
      .delete()
      .in('id', handledJobIds)
    if (deleteError) throw new Error(`Failed to clear handled jobs: ${deleteError.message}`)
  }

  console.log(`generate-announcement-clip: ${byKey.size} keys (${rendered} rendered, ${skipped} skipped, ${failed} failed)`)
  return { processed: byKey.size, rendered, skipped, failed, errors }
}

// ── Azure TTS ────────────────────────────────────────────────────────────────

async function synthesize(text: string, voice: string, azureKey: string, azureRegion: string): Promise<Uint8Array> {
  const ssml = `<speak version="1.0" xml:lang="en-GB">` +
    `<voice name="${voice}">${escapeXml(text)}</voice></speak>`
  const res = await fetch(
    `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': AUDIO_FORMAT,
        'User-Agent': 'route-tracker-generate-announcement-clip',
      },
      body: ssml,
    },
  )
  if (!res.ok) throw new Error(`Azure TTS error ${res.status}: ${await res.text()}`)
  return new Uint8Array(await res.arrayBuffer())
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Same algorithm as generate-announcement-audio.mjs's hashText(): sha256 of
// `${voice}|${AUDIO_FORMAT}|${text}`, first 16 hex chars.
export async function hashText(voice: string, text: string): Promise<string> {
  const data = new TextEncoder().encode(`${voice}|${AUDIO_FORMAT}|${text}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
