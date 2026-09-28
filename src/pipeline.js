// One post in -> zero or more applications out.
const fs = require('fs');
const path = require('path');
const { paths, rules, gmail, whatsapp } = require('./config');
const { extractJobs } = require('./extract');
const { keywordScore, cvToText } = require('./ats');
const { tailorCv } = require('./tailor');
const { ruleTailor } = require('./tailor-rules');
const { parseJobPost } = require('./parse');
const { ruleScore } = require('./match');
const { renderPdf } = require('./pdf');
const { sendApplication, signature } = require('./mailer');
const store = require('./store');

const masterCv = () => JSON.parse(fs.readFileSync(paths.masterCv, 'utf8'));
const slug = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelayMs = () => 1000 * (rules.minDelaySec + Math.random() * (rules.maxDelaySec - rules.minDelaySec));

/**
 * @param {{text:string, image?:{mimetype:string,data:string}}} post
 * @param {{sendWhatsApp?:(number:string, message:string, pdfPath:string, pdfName:string)=>Promise<void>,
 *          notify?:(text:string)=>Promise<void>, log?:(s:string)=>void}} io
 */
async function processPost(post, io = {}) {
  const log = io.log || console.log;
  const notify = io.notify || (async () => {});
  const cv = masterCv();
  const cvText = cvToText(cv);

  const lower = String(post.text || '').toLowerCase();
  if (!post.image && !whatsapp.roleKeywords.some((k) => lower.includes(k))) {
    log('  not your role (no Angular/frontend keywords), skipped - no AI used');
    return [];
  }

  // Text posts are read with rules (free). AI only for image posters or posts the rules can't read.
  let jobs = [];
  const parsed = post.image ? null : parseJobPost(post.text);
  if (parsed) {
    jobs = [parsed];
  } else if (post.image || /hiring|opening|vacanc|looking for/i.test(lower)) {
    log(`  reading ${post.image ? 'image poster' : 'post'} with AI...`);
    jobs = await extractJobs(post.text, post.image);
  }
  if (!jobs.length) return [];
  log(`Job post: ${jobs.map((j) => j.title).join(' / ')}${parsed ? ' (read without AI)' : ''}`);

  const results = [];
  for (const job of jobs) {
    const r = await processJob(job, { cv, cvText, io, log, notify });
    results.push(r);
    store.logRow(r);
    log(`  [${r.status}] ${job.title} @ ${job.company || '?'} score=${r.score ?? '-'} ${r.reason ? `(${r.reason})` : ''}`);
    if (r.status === 'skipped' && whatsapp.notifySkipped) {
      await notify(`⏭ Skipped: ${job.title} @ ${job.company || '?'}${r.score != null ? ` (${r.score}/100)` : ''}
${String(r.reason).slice(0, 160)}`);
    }
  }
  return results;
}

async function processJob(job, { cv, cvText, io, log, notify }) {
  const base = { title: job.title, company: job.company, contact: job.apply_email || job.apply_whatsapp || job.apply_link || '' };
  const skip = (reason, extra = {}) => ({ ...base, status: 'skipped', reason, ...extra });

  if (store.alreadyApplied(job)) return skip('already applied recently');

  if (job.experience_min != null && job.experience_min > cv.totalExperienceYears + rules.experienceTolerance) {
    return skip(`needs ${job.experience_min}+ yrs`);
  }

  const rs = ruleScore(job, cvText);
  const before = rs.kw;
  if (rs.fit.mismatch) return skip(rs.fit.why, { score: rs.score, keywordScore: before.score, atsBefore: before.score, missing: before.missing.join('; ') });
  if (rs.score < rules.minScore) {
    return skip(`score below ${rules.minScore} (${rs.fit.why}, skills ${before.matched.length}/${before.matched.length + before.missing.length})`,
      { score: rs.score, keywordScore: before.score, atsBefore: before.score, missing: before.missing.join('; ') });
  }

  const channelFor = () => (job.apply_email && gmail.user ? 'email' : job.apply_whatsapp && io.sendWhatsApp ? 'whatsapp' : 'manual');
  const willSend = channelFor() !== 'manual' && !rules.dryRun && store.appliedToday() < rules.maxPerDay;

  // Spend AI only on applications that really go out; otherwise (or if AI is down) tailor by rules.
  let t;
  if (willSend) {
    try {
      t = await tailorCv(cv, job);
      if (!t.roleMatch) return skip(`AI says different role: ${t.fitReason}`, { score: rs.score, keywordScore: before.score });
    } catch (e) {
      log(`  AI not available (${e.message.slice(0, 60)}), tailoring CV without AI`);
    }
  }
  t ??= ruleTailor(cv, job);

  const after = keywordScore(job.keywords, cvToText(t.cv));
  const score = rs.score;
  const scores = {
    score, keywordScore: before.score, fitScore: t.fitScore ?? '',
    atsBefore: before.score, atsAfter: after.score, missing: before.missing.join('; '),
  };

  const channel = job.apply_email && gmail.user ? 'email' : job.apply_whatsapp && io.sendWhatsApp ? 'whatsapp' : 'manual';

  const pdfName = `${slug(cv.name)}_${slug(job.title)}_Resume.pdf`;
  const pdfPath = path.join(paths.out, `${new Date().toISOString().slice(0, 10)}_${slug(job.company) || 'company'}_${slug(job.title)}.pdf`);
  await renderPdf(t.cv, pdfPath);
  // Keep the email/message next to the PDF so every application can be reviewed later.
  fs.writeFileSync(pdfPath.replace(/\.pdf$/, '.txt'),
    `JOB\n${JSON.stringify(job, null, 2)}\n\nSCORES\n${JSON.stringify(scores, null, 2)}\nFit: ${t.fitReason}\n\n` +
    `EMAIL SUBJECT\n${t.emailSubject}\n\nEMAIL BODY\n${t.emailBody}${signature(cv)}\n\nWHATSAPP\n${t.whatsappMessage}\n`);

  const result = { ...base, ...scores, channel, pdf: pdfPath, reason: t.fitReason };

  if (channel === 'manual') {
    const how = job.apply_email ? `${job.apply_email} (set GMAIL_USER in .env to auto-send)` : job.apply_link || 'No contact found in the post';
    await notify(`📝 *Apply manually* (${score}/100)\n${job.title} @ ${job.company || '?'}\n${how}\nTailored CV: ${pdfPath}`);
    return { ...result, status: 'manual' };
  }

  if (store.appliedToday() >= rules.maxPerDay) {
    await notify(`⏸ Daily limit (${rules.maxPerDay}) reached, not sent: ${job.title} @ ${job.company || '?'} (${score}/100). CV: ${pdfPath}`);
    return { ...result, status: 'daily-limit' };
  }

  if (rules.dryRun) {
    store.recordApplication(job, true);
    await notify(`🧪 *DRY RUN* would apply via ${channel} to ${base.contact}\n${job.title} @ ${job.company || '?'}\nScore ${score}/100 (ATS ${before.score}→${after.score})\n${t.fitReason}`);
    return { ...result, status: 'dry-run' };
  }

  const wait = randomDelayMs();
  log(`  waiting ${Math.round(wait / 1000)}s before sending...`);
  await sleep(wait);

  try {
    if (channel === 'email') {
      await sendApplication({ to: job.apply_email, subject: t.emailSubject, body: t.emailBody, cv, pdfPath, pdfName });
    } else {
      await io.sendWhatsApp(job.apply_whatsapp, t.whatsappMessage, pdfPath, pdfName);
    }
  } catch (e) {
    await notify(`❌ Failed to apply to ${job.title} @ ${job.company || '?'}: ${e.message}`);
    return { ...result, status: 'error', reason: e.message };
  }

  store.recordApplication(job, false);
  await notify(`✅ *Applied* via ${channel} to ${base.contact}\n${job.title} @ ${job.company || '?'}\nScore ${score}/100 (ATS ${before.score}→${after.score})\nMissing: ${before.missing.join(', ') || 'none'}`);
  return { ...result, status: 'applied' };
}

module.exports = { processPost };
