// Reads LinkedIn job-alert emails from the Gmail inbox (read-only, mails are left unread) and turns every
// listed job into a post for the normal pipeline. No LinkedIn login or scraping is involved.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { gmail, linkedin } = require('./config');
const { PLATFORM_SENDERS, parseByPlatform } = require('./alert-sources');

const TOO_SENIOR = /\b(?:lead|principal|architect|manager|head|director|staff|vp)\b/i;
const NOISE = /view job|apply|ago|applicant|easy|promoted|actively|alumni|connection|see more|^\W*$/i;
const strip = (h) => String(h).replace(/<(?:br|\/p|\/div|\/tr|\/td|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&middot;|&#183;/g, '·').replace(/[ \t]+/g, ' ');
const lines = (h) => strip(h).split('\n').map((l) => l.trim()).filter(Boolean);

/** Jobs listed in one alert email: [{id, title, company, location, link}] */
function jobsFromHtml(html) {
  const re = /<a[^>]+href="([^"]*linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^"/?]*-)?(\d{6,})[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const hits = [];
  for (let m; (m = re.exec(html));) hits.push({ id: m[2], end: re.lastIndex, text: lines(m[3]).join(' ').trim() });
  const jobs = new Map();
  hits.forEach((h, i) => {
    if (!/[a-z]{3}/i.test(h.text) || NOISE.test(h.text) || jobs.has(h.id)) return;
    // Company and location are the first plain lines after the title link, before the next job.
    const next = hits.slice(i + 1).find((o) => o.id !== h.id);
    const after = lines(html.slice(h.end, next ? next.end - 200 : h.end + 1500)).filter((l) => !NOISE.test(l));
    const [company, location] = (after[0] || '').includes('·') ? after[0].split('·').map((s) => s.trim()) : [after[0], after[1]];
    jobs.set(h.id, { id: h.id, title: h.text, company: company || null, location: location || null, link: `https://www.linkedin.com/jobs/view/${h.id}` });
  });
  return [...jobs.values()];
}

/** The text that is handed to the pipeline: looks like a normal hiring post, with the job link to apply. */
function postText(j) {
  return [`Hiring: ${j.title}`, j.company && `Company: ${j.company}`, j.location && `Location: ${j.location}`, `Apply: ${j.link}`, `(${j.platform || 'LinkedIn'} job alert)`]
    .filter(Boolean).join('\n');
}

async function fetchAlertMails(days = 1) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false, auth: { user: gmail.user, pass: gmail.appPassword } });
  client.on('error', () => {});
  const mails = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = await client.search({ or: PLATFORM_SENDERS.map((from) => ({ from })), since: new Date(Date.now() - days * 86400000) }, { uid: true });
      for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
        const mail = await simpleParser(msg.source);
        const from = (mail.from && mail.from.text) || '';
        if (!/job|alert|match|invited|opportunit/i.test(`${from} ${mail.subject}`)) continue;
        mails.push({ id: mail.messageId || String(msg.uid), from: from.toLowerCase(), subject: mail.subject || '', html: mail.html || '' });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return mails;
}

/** All new jobs from recent alert mails: [{text, source}] ready for the pipeline. */
async function collectAlertJobs({ log, isDone, markDone }) {
  const out = [];
  for (const mail of await fetchAlertMails(1)) {
    if (isDone(`alertmail:${mail.id}`)) continue;
    const other = parseByPlatform(mail);
    const platform = other ? other.platform : 'LinkedIn';
    const jobs = (other ? other.jobs : jobsFromHtml(mail.html)).filter((j) => !TOO_SENIOR.test(j.title)).map((j) => ({ ...j, platform }));
    log(`${platform} alert email "${(mail.subject || '').slice(0, 60)}": ${jobs.length} job(s)`);
    // The same job comes in many emails with different tracking links, so de-duplicate by title + company.
    for (const j of jobs) out.push({ text: postText(j), source: `${platform} alert email`, key: `alertjob:${j.title}|${j.company || ''}`.toLowerCase() });
    markDone(`alertmail:${mail.id}`);
  }
  return out;
}

function startAlerts({ onPost, log, isDone, markDone }) {
  if (!gmail.user || !gmail.appPassword) return;
  async function poll() {
    try {
      for (const p of await collectAlertJobs({ log, isDone, markDone })) await onPost(p);
    } catch (e) {
      log(`LinkedIn alert emails: ${e.message}`);
    }
    setTimeout(poll, linkedin.alertsEveryMin * 60000);
  }
  setTimeout(poll, 45 * 1000);
  log(`LinkedIn alert emails: reading Gmail every ${linkedin.alertsEveryMin} min`);
}

module.exports = { startAlerts, jobsFromHtml, postText, fetchAlertMails };
