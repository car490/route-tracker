import { describe, it, expect } from 'vitest'
import { buildReviewView, clipAudioUrl, voiceLabel, attentionKind } from './clipReview.js'

const clip = (over) => ({
  key: 'approach/a', text: 'This is Boston, College.', storage_path: 'approach/a.mp3', hash: 'h1',
  rendered_at: '2026-09-24T19:00:00Z', loudness_lufs: -21.0, true_peak_db: -2.2,
  reviewed: false, reviewed_at: null, reviewed_by: null, ...over,
})

describe('buildReviewView', () => {
  it('splits clips into to-review and approved, keeping the server order', () => {
    const v = buildReviewView({
      clips: [clip({ key: 'a' }), clip({ key: 'b' }), clip({ key: 'c', reviewed: true, reviewed_by: 'John' })],
      attention: [], usage: { today_chars: 0, month_chars: 0, cap: '6000' }, voice: null,
    })
    expect(v.toReview.map((c) => c.key)).toEqual(['a', 'b'])
    expect(v.approved.map((c) => c.key)).toEqual(['c'])
  })

  it('works out today\'s credit use against the cap, and flags a paused cap', () => {
    const v = buildReviewView({ clips: [], attention: [], usage: { today_chars: 1500, month_chars: 4200, cap: '6000' } })
    expect(v.usage).toEqual({ todayChars: 1500, monthChars: 4200, cap: 6000, percent: 25, paused: false })
    expect(buildReviewView({ clips: [], attention: [], usage: { today_chars: 0, month_chars: 0, cap: '0' } }).usage.paused).toBe(true)
    // Missing cap falls back to the drain's default.
    expect(buildReviewView({ clips: [], attention: [], usage: { today_chars: 0, month_chars: 0, cap: null } }).usage.cap).toBe(6000)
  })

  it('never shows more than 100% of the cap', () => {
    expect(buildReviewView({ clips: [], attention: [], usage: { today_chars: 9000, month_chars: 9000, cap: '6000' } }).usage.percent).toBe(100)
  })

  it('copes with an empty or missing status', () => {
    const v = buildReviewView(null)
    expect(v.toReview).toEqual([])
    expect(v.attention).toEqual([])
  })
})

describe('attentionKind', () => {
  it('names the reason a queue item needs attention', () => {
    expect(attentionKind({ attempts: 3, last_error: 'Ben clip is out of date ("a" -> "b") but ...' })).toBe('stale')
    expect(attentionKind({ attempts: 0, last_error: 'daily ElevenLabs character cap reached (6000 of 6000 used today, UTC)' })).toBe('capped')
    expect(attentionKind({ attempts: 3, last_error: 'ElevenLabs error 401: invalid key' })).toBe('failed')
    expect(attentionKind({ attempts: 1, last_error: 'ElevenLabs error 500' })).toBe('retrying')
  })
})

describe('clipAudioUrl', () => {
  it('builds the public Storage URL with the version hash so a re-render is never served from cache', () => {
    expect(clipAudioUrl('https://x.supabase.co', 'departure/00000000-0000-0000-0002-000000000023.mp3', 'abc123'))
      .toBe('https://x.supabase.co/storage/v1/object/public/announcement-audio/departure/00000000-0000-0000-0002-000000000023.mp3?v=abc123')
  })

  it('encodes each path segment', () => {
    expect(clipAudioUrl('https://x.supabase.co', 'service/s116s__boston college.mp3', 'h'))
      .toBe('https://x.supabase.co/storage/v1/object/public/announcement-audio/service/s116s__boston%20college.mp3?v=h')
  })
})

describe('voiceLabel', () => {
  it('says which voice this environment is using', () => {
    expect(voiceLabel('elevenlabs:eUlIljct4YrEQRcEqrii')).toBe('Ben (ElevenLabs)')
    expect(voiceLabel('en-GB-RyanNeural')).toBe('Azure (en-GB-RyanNeural)')
    expect(voiceLabel(null)).toBe('Azure (en-GB-RyanNeural)')
  })
})
