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

function unmarkSeen(text) {
  delete state.seen[hash(text)];
  save();
}

function contactKey(job) {
  return job.apply_email || job.apply_whatsapp || hash(`${job.company}|${job.title}`);
}

function alreadyApplied(job) {
  const key = contactKey(job);
  const cutoff = Date.now() - rules.reapplyAfterDays * 86400000;
  const titleKey = hash(`${job.company}|${job.title}`);
  // Dry-run entries only block other dry runs, so going live doesn't skip jobs seen while testing.
  return state.applied.some((a) => a.at > cutoff && (!a.dryRun || rules.dryRun) && (a.key === key || a.titleKey === titleKey));
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

module.exports = { markSeen, unmarkSeen, alreadyApplied, appliedToday, recordApplication, logRow };
