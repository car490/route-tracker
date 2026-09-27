// Daily ElevenLabs character cap (docs/ANNOUNCE-VOICE-PLAN.md, credit
// safeguards). Starter gives 30,000 credits a month at 1 credit per character;
// the cap stops a bulk data change (e.g. a NaPTAN re-import) from spending the
// month in one go. Set per environment in app_config
// 'elevenlabs_daily_char_cap'; '0' pauses all Ben rendering.

// Fits the first full production run (about 4,900 characters) in one day.
export const DEFAULT_DAILY_CHAR_CAP = 6000;

export function parseDailyCap(value) {
  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_DAILY_CHAR_CAP;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CHAR_CAP;
}

export function fitsDailyCap({ usedToday, chars, cap }) {
  return usedToday + chars <= cap && cap > 0;
}
