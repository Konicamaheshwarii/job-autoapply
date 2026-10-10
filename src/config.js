const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..');

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

// "provider:model" entries, tried in order. Free tiers: Groq is generous, Gemini 2.5-flash allows only 20/day.
const DEFAULT_CHAIN = 'groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,gemini:gemini-2.5-flash-lite,gemini:gemini-3.8-flash,gemini:gemini-2.5-flash';
const DEFAULT_VISION_CHAIN = 'groq:qwen/qwen3.8-27b,gemini:gemini-2.5-flash-lite,gemini:gemini-3.8-flash,gemini:gemini-2.5-flash';

const parseChain = (v) => v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.indexOf(':');
  return { provider: s.slice(0, i).toLowerCase(), model: s.slice(i + 1) };
});

// Older .env files used AI_PROVIDER + AI_API_KEY for a single provider.
const legacyProvider = (process.env.AI_PROVIDER || '').toLowerCase();
const keyFor = (p) => process.env[`${p.toUpperCase()}_API_KEY`] || (legacyProvider === p ? process.env.AI_API_KEY : '') || '';

module.exports = {
  ROOT,
  paths: {
    masterCv: path.join(ROOT, 'cv', 'master-cv.json'),
    data: path.join(ROOT, 'data'),
    out: path.join(ROOT, 'out'),
    state: path.join(ROOT, 'data', 'state.json'),
    log: path.join(ROOT, 'data', 'applications.csv'),
  },
  ai: {
    keys: { groq: keyFor('groq'), gemini: keyFor('gemini'), openai: keyFor('openai'), anthropic: keyFor('anthropic') },
    chain: parseChain(process.env.AI_CHAIN || DEFAULT_CHAIN),
    visionChain: parseChain(process.env.AI_VISION_CHAIN || DEFAULT_VISION_CHAIN),
    get model() { return this.chain.filter((e) => this.keys[e.provider]).map((e) => `${e.provider}:${e.model}`).join(' > '); },
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  },
  whatsapp: {
    // Comma-separated group names, matched case-insensitively
    groups: (process.env.WHATSAPP_GROUPS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    notifySelf: bool(process.env.NOTIFY_SELF, true),
    // Also message you about jobs that were skipped (wrong role, low score...)
    notifySkipped: bool(process.env.NOTIFY_SKIPPED, true),
    // Text posts must mention one of these to be sent to the AI (saves quota). Image posts always go to the AI.
    roleKeywords: (process.env.ROLE_KEYWORDS
      || 'angular,front end,frontend,front-end,typescript,javascript,ui developer,ui engineer,mean stack,web developer,rxjs,ngrx')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // On start, check posts from today (since midnight) that arrived while the bot was off
    backfillToday: bool(process.env.BACKFILL_TODAY, true),
    backfillLimit: num(process.env.BACKFILL_LIMIT, 500),
    // How many days of old posts to check on start: 1 = today, 2 = today + yesterday, ...
    backfillDays: Math.max(1, num(process.env.BACKFILL_DAYS, 1)),
    // Windows: don't let the PC fall asleep when idle while the bot runs
    keepAwake: bool(process.env.KEEP_AWAKE, true),
  },
  // Read-only LinkedIn post search (needs a one-time `npm run linkedin-login`)
  linkedin: {
    enabled: bool(process.env.LINKEDIN_ENABLED, false),
    searches: (process.env.LINKEDIN_SEARCHES || 'hiring angular developer|angular developer send resume email').split('|').map((s) => s.trim()).filter(Boolean),
    intervalMin: num(process.env.LINKEDIN_INTERVAL_MIN, 90),
    fromHour: num(process.env.LINKEDIN_FROM_HOUR, 9),
    toHour: num(process.env.LINKEDIN_TO_HOUR, 20),
    maxPostsPerSearch: num(process.env.LINKEDIN_MAX_POSTS, 25),
    maxImagesPerRun: num(process.env.LINKEDIN_MAX_IMAGES, 5),
  },
  gmail: {
    user: process.env.GMAIL_USER || '',
    appPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  },
  rules: {
    minScore: num(process.env.MIN_SCORE, 70),
    maxPerDay: num(process.env.MAX_APPLICATIONS_PER_DAY, 12),
    // Skip jobs asking for more than (your years + this) experience
    experienceTolerance: num(process.env.EXPERIENCE_TOLERANCE_YEARS, 1),
    // Never apply to the same email / number again within this many days
    reapplyAfterDays: num(process.env.REAPPLY_AFTER_DAYS, 30),
    // Random wait before each send, in seconds
    minDelaySec: num(process.env.MIN_SEND_DELAY_SEC, 45),
    maxDelaySec: num(process.env.MAX_SEND_DELAY_SEC, 180),
    // true = do everything except actually sending
    dryRun: bool(process.env.DRY_RUN, true),
    // Let AI rewrite CV bullets. Off: it tends to invent experience to match the job.
    aiTailoring: bool(process.env.AI_TAILORING, false),
  },
};
