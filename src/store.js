// Tiny JSON + CSV persistence: seen messages, past applications, daily count.
const fs = require('fs');
const crypto = require('crypto');
const { paths, rules } = require('./config');

fs.mkdirSync(paths.data, { recursive: true });
fs.mkdirSync(paths.out, { recursive: true });

function load() {
  try {
    return JSON.parse(fs.readFileSync(paths.state, 'utf8'));
  } catch {
    return { seen: {}, applied: [] };
  }
}
const state = load();
const save = () => fs.writeFileSync(paths.state, JSON.stringify(state, null, 2));

const hash = (s) => crypto.createHash('sha1').update(String(s).toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

/** Returns true the first time a given text is seen (forwarded duplicates are skipped). */
function markSeen(text) {
  const h = hash(text);
  if (state.seen[h]) return false;
  state.seen[h] = Date.now();
  // keep the file small
  const keys = Object.keys(state.seen);
  if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete state.seen[k];
  save();
  return true;
}

function isSeen(text) {
  return Boolean(state.seen[hash(text)]);
}

function unmarkSeen(text) {
  delete state.seen[hash(text)];
  save();
}

// Posts that are marked seen but not finished yet. If the bot restarts or crashes mid-way (e.g. while
// waiting to send), they stay here and are un-marked on the next start, so the backfill picks them up again.
state.pending ??= {};
const MAX_TRIES = 3;

function startWork(keys) {
  for (const k of keys) state.pending[hash(k)] = (state.pending[hash(k)] || 0) + 1;
  save();
}

function endWork(keys) {
  for (const k of keys) delete state.pending[hash(k)];
  save();
}

/** Call once on start. Returns how many unfinished posts will be checked again. */
function retryUnfinished() {
  let n = 0;
  for (const [h, tries] of Object.entries(state.pending)) {
    if (tries >= MAX_TRIES) {
      delete state.pending[h]; // keeps failing: give up on it
    } else {
      delete state.seen[h];
      n++;
    }
  }
  save();
  return n;
}

function contactKey(job) {
  return job.apply_email || job.apply_whatsapp || hash(`${job.company}|${job.title}`);
}

function alreadyApplied(job) {
  const key = contactKey(job);
  const cutoff = Date.now() - rules.reapplyAfterDays * 86400000;
  // Same company + same title counts as the same job, but only when the company is actually known:
  // "Senior Angular Developer" at two unnamed companies are two different jobs.
  const titleKey = job.company ? hash(`${job.company}|${job.title}`) : null;
  // Dry-run entries only block other dry runs, so going live doesn't skip jobs seen while testing.
  return state.applied.some((a) => a.at > cutoff && (!a.dryRun || rules.dryRun)
    && (a.key === key || (titleKey && a.titleKey === titleKey)));
}

function appliedToday() {
  return state.applied.filter((a) => a.day === today() && !a.dryRun).length;
}

function recordApplication(job, dryRun) {
  state.applied.push({ key: contactKey(job), titleKey: hash(`${job.company}|${job.title}`), at: Date.now(), day: today(), dryRun });
  save();
}

const CSV_HEADER = 'timestamp,status,score,keyword_score,fit_score,title,company,channel,contact,ats_before,ats_after,missing_skills,reason,pdf\n';
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

function logRow(row) {
  if (!fs.existsSync(paths.log)) fs.writeFileSync(paths.log, '﻿' + CSV_HEADER); // BOM so Excel reads UTF-8
  const cols = ['status', 'score', 'keywordScore', 'fitScore', 'title', 'company', 'channel', 'contact', 'atsBefore', 'atsAfter', 'missing', 'reason', 'pdf'];
  fs.appendFileSync(paths.log, [new Date().toISOString(), ...cols.map((c) => row[c])].map(csvCell).join(',') + '\n');
}

/** Remembers the last time the bot was running, so the next start can catch up on everything posted while the PC was off. */
function touchActive() {
  state.lastActive = Date.now();
  save();
}
const lastActive = () => state.lastActive || 0;

module.exports = { touchActive, lastActive, markSeen, unmarkSeen, isSeen, startWork, endWork, retryUnfinished, alreadyApplied, appliedToday, recordApplication, logRow };
