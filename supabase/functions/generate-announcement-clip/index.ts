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
import { BEN, LEVELLING, ELEVENLABS_BATCH_SIZE, MAX_JOB_ATTEMPTS } from '../_shared/announce-voice/voiceConfig.mjs'
import { isElevenLabsVoice, elevenLabsVoiceId, decideClipAction } from '../_shared/announce-voice/renderDecision.mjs'
import { buildElevenLabsRequest, elevenLabsClipHash } from '../_shared/announce-voice/elevenLabsRequest.mjs'
import { levelClip, integratedLoudness, truePeakDb, correctionGainDb, applyGainDb } from '../_shared/announce-voice/levelling.mjs'

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
  attempts?: number
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
//
// Two voices share one queue: Azure (unchanged behaviour) and ElevenLabs "Ben"
// (docs/ANNOUNCE-VOICE-PLAN.md), selected per job by its `voice` value
// ('elevenlabs:<id>' for Ben, set from app_config.announcement_voice).
// Rules added for Ben:
//   * a Ben clip is never replaced by any other voice (decideClipAction)
//   * at most ELEVENLABS_BATCH_SIZE Ben renders per run (Edge CPU allowance)
//   * a failing job is retried at most MAX_JOB_ATTEMPTS times, then left in
//     the queue with its last_error for ops to see, so a bad key or a clip
//     that can't be levelled can't spend credits in a loop

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
    .select('id, key, text, voice, requested_at, attempts')
    .lt('attempts', MAX_JOB_ATTEMPTS)
    .order('requested_at', { ascending: true })
    .limit(batchSize)
  if (fetchError) throw new Error(`Failed to read announcement_clip_jobs: ${fetchError.message}`)
  if (!jobs || jobs.length === 0) {
    return { processed: 0, rendered: 0, skipped: 0, protected: 0, deferred: 0, failed: 0, errors: [] }
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

  let rendered = 0, skipped = 0, protectedCount = 0, deferred = 0, failed = 0, benRenders = 0
  const errors: { key: string; message: string }[] = []
  const handledJobIds: string[] = []

  for (const [key, { job, jobIds }] of byKey) {
    const isBen = isElevenLabsVoice(job.voice)
    try {
      const hash = isBen
        ? await elevenLabsClipHash(job.text, BEN, LEVELLING)
        : await hashText(job.voice, job.text)

      const { data: existingClip } = await supabase
        .from('announcement_clips')
        .select('hash, voice')
        .eq('key', key)
        .maybeSingle()

      const action = decideClipAction({ jobVoice: job.voice, newHash: hash, existing: existingClip })
      if (action === 'skip-unchanged') {
        skipped++
        handledJobIds.push(...jobIds)
        continue
      }
      if (action === 'skip-protected') {
        protectedCount++
        handledJobIds.push(...jobIds)
        console.warn(`generate-announcement-clip: kept Ben clip for ${key}; refused to replace it with ${job.voice}`)
        continue
      }
      if (isBen && benRenders >= ELEVENLABS_BATCH_SIZE) {
        deferred++ // left queued, untouched, for the next run
        continue
      }

      let mp3: Uint8Array
      let meta: Record<string, unknown> = {}
      if (isBen) {
        benRenders++
        const ben = await renderBen(job.voice, job.text)
        mp3 = ben.mp3
        meta = {
          model: BEN.modelId,
          voice_settings: BEN.voiceSettings,
          loudness_lufs: Math.round(ben.loudnessLufs * 100) / 100,
          true_peak_db: Math.round(ben.truePeakDb * 100) / 100,
        }
      } else {
        mp3 = await synthesize(job.text, job.voice, azureKey, azureRegion)
      }
      const storagePath = `${key}.mp3`

      const { error: uploadError } = await supabase.storage
        .from('announcement-audio')
        .upload(storagePath, mp3, { contentType: 'audio/mpeg', upsert: true, cacheControl: '300' })
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

      const { error: upsertError } = await supabase
        .from('announcement_clips')
        .upsert(
          {
            key, storage_path: storagePath, hash, text: job.text, voice: job.voice, rendered_at: new Date().toISOString(),
            model: null, voice_settings: null, loudness_lufs: null, true_peak_db: null, ...meta,
          },
          { onConflict: 'key' },
        )
      if (upsertError) throw new Error(`announcement_clips upsert failed: ${upsertError.message}`)

      rendered++
      handledJobIds.push(...jobIds)
    } catch (err) {
      // Left in the queue for a retry, up to MAX_JOB_ATTEMPTS; after that the
      // row stays with its last_error for ops to see instead of looping.
      failed++
      const message = String(err).slice(0, 500)
      errors.push({ key, message })
      console.error(`generate-announcement-clip: failed key ${key}: ${message}`)
      await supabase
        .from('announcement_clip_jobs')
        .update({ attempts: (job.attempts ?? 0) + 1, last_error: message, last_attempt_at: new Date().toISOString() })
        .in('id', jobIds)
    }
  }

  if (handledJobIds.length) {
    const { error: deleteError } = await supabase
      .from('announcement_clip_jobs')
      .delete()
      .in('id', handledJobIds)
    if (deleteError) throw new Error(`Failed to clear handled jobs: ${deleteError.message}`)
  }

  console.log(`generate-announcement-clip: ${byKey.size} keys (${rendered} rendered, ${skipped} skipped, ${protectedCount} protected, ${deferred} deferred, ${failed} failed)`)
  return { processed: byKey.size, rendered, skipped, protected: protectedCount, deferred, failed, errors }
}

// ── ElevenLabs "Ben" ─────────────────────────────────────────────────────────
// Render, level to the target loudness, encode, then re-measure the encoded
// file: a clip is only stored if the finished MP3 is within the limits.
// The MP3 codecs load on first use only, so an Azure-only run never needs them.

async function renderBen(voice: string, text: string) {
  if (elevenLabsVoiceId(voice) !== BEN.voiceId) {
    throw new Error(`unknown ElevenLabs voice ${voice}; only the pinned Ben voice is allowed`)
  }
  const req = buildElevenLabsRequest(text, BEN, Deno.env.get('ELEVENLABS_API_KEY') ?? '')
  const res = await fetch(req.url, req.init)
  if (!res.ok) {
    // Never echo request headers; the response body is ElevenLabs' own error text.
    throw new Error(`ElevenLabs error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const raw = new Uint8Array(await res.arrayBuffer())

  const { samples, sampleRate } = await decodeMp3(raw)
  const levelled = levelClip(samples, sampleRate, LEVELLING)
  if (!levelled.ok) throw new Error(`levelling refused the clip: ${levelled.reason}`)

  let mp3 = await encodeMp3(levelled.samples, sampleRate)
  let check = await decodeMp3(mp3)
  let loudnessLufs = integratedLoudness(check.samples, check.sampleRate)
  let truePeak = truePeakDb(check.samples)

  // Encoding lands slightly below the level set (see correctionGainDb); one
  // correction pass brings it back to target.
  const correction = correctionGainDb(loudnessLufs, truePeak, LEVELLING)
  if (correction !== 0) {
    mp3 = await encodeMp3(applyGainDb(levelled.samples, correction), sampleRate)
    check = await decodeMp3(mp3)
    loudnessLufs = integratedLoudness(check.samples, check.sampleRate)
    truePeak = truePeakDb(check.samples)
  }
  if (Math.abs(loudnessLufs - LEVELLING.targetLufs) > LEVELLING.toleranceLu || truePeak > LEVELLING.truePeakCeilingDb) {
    throw new Error(`encoded clip out of limits: ${loudnessLufs.toFixed(2)} LUFS, ${truePeak.toFixed(2)} dBTP`)
  }
  return { mp3, loudnessLufs, truePeakDb: truePeak }
}

async function decodeMp3(bytes: Uint8Array) {
  const { MPEGDecoder } = await import('npm:mpg123-decoder@1.0.3')
  const decoder = new MPEGDecoder()
  await decoder.ready
  try {
    const { channelData, sampleRate } = decoder.decode(bytes)
    if (!channelData?.length || !channelData[0].length) throw new Error('MP3 decoded to no audio')
    return { samples: channelData[0] as Float32Array, sampleRate: sampleRate as number }
  } finally {
    decoder.free()
  }
}

async function encodeMp3(samples: Float32Array, sampleRate: number): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('npm:@breezystack/lamejs@1.2.7')
  const encoder = new Mp3Encoder(1, sampleRate, 128)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  const parts: Uint8Array[] = []
  for (let i = 0; i < pcm.length; i += 1152) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152))
    if (chunk.length) parts.push(new Uint8Array(chunk))
  }
  const tail = encoder.flush()
  if (tail.length) parts.push(new Uint8Array(tail))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
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
