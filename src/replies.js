// Watches the Gmail inbox (read-only) for replies to the applications the bot sent, and tells the user on
// WhatsApp right away: recruiters usually only wait a day or two for the candidate to answer.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { gmail, candidate, autoReply } = require('./config');
const { sendEmail } = require('./mailer');
const { markReplied } = require('./store');

const FREE = /^(gmail|yahoo|outlook|hotmail|rediffmail|live|icloud)\./i;
const REJECT = /not (?:be )?moving forward|regret to|unfortunately|rejected|not shortlisted|other candidates|position has been filled|won'?t be (?:moving|proceeding)/i;
const GOOD = /shortlist|interview|schedule|call|discussion|round|slot|availab|ctc|notice|last working|expected|current|details|form|assessment|test|link/i;
const quote = /\n(?:On .{10,120}wrote:|From:\s.*|-{3,}\s*Original Message)[\s\S]*$/i;

/** @returns {Promise<{id:string, from:string, subject:string, text:string, kind:'reply'|'rejected'|'bounce'}[]>} */
async function findReplies(days, appliedEmails) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false, auth: { user: gmail.user, pass: gmail.appPassword } });
  client.on('error', () => {});
  const sent = new Set(appliedEmails);
  const domains = new Set(appliedEmails.map((e) => e.split('@')[1]).filter((d) => d && !FREE.test(d)));
  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = await client.search({ since: new Date(Date.now() - days * 86400000) }, { uid: true });
      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        const mail = await simpleParser(msg.source);
        const from = ((mail.from && mail.from.value[0] && mail.from.value[0].address) || '').toLowerCase();
        const name = (mail.from && mail.from.value[0] && mail.from.value[0].name) || '';
        const subject = mail.subject || '';
        if (!from || from === gmail.user.toLowerCase()) continue;
        const text = String(mail.text || '').replace(quote, '').replace(/\s+/g, ' ').trim();
        const id = mail.messageId || `uid${msg.uid}`;
        if (/mailer-daemon|postmaster/.test(from) || /undeliver|delivery status|address not found|failure notice/i.test(subject)) {
          out.push({ id, from, subject, kind: 'bounce', text: (String(mail.text || '').match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).find((a) => a.toLowerCase() !== gmail.user.toLowerCase()) || text.slice(0, 120) });
          continue;
        }
        const dom = from.split('@')[1];
        const isReply = /^(re|fwd?):/i.test(subject) && /Application for/i.test(subject);
        const fromCompany = sent.has(from) || (domains.has(dom) && !FREE.test(dom)) || isReply;
        if (!fromCompany) continue;
        const noReply = /no-?reply|donotreply|notification/.test(from);
        if (REJECT.test(text)) out.push({ id, from, name, subject, text, kind: 'rejected' });
        else if (!noReply || /interview|shortlist|schedule|assessment/i.test(text)) { if (GOOD.test(text) || !noReply) out.push({ id, from, name, subject, text, kind: 'reply' }); }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return out;
}

// What recruiters usually ask for in a first reply, and what must never be answered automatically.
const ASKS = /ctc|salary|package|notice|last working|\blwd\b|current location|preferred location|expected|total exp|relevant exp|your details|share (?:the )?(?:below |following )?details|availability|available for|updated (?:cv|resume)/i;
const SENSITIVE = /\bpan\b|aadhaa?r|date of birth|\bdob\b|bank|passport|salary slip|payslip|offer letter/i;
const FORM = /forms\.(?:gle|office|cloud\.microsoft)|docs\.google\.com\/forms|typeform|fill (?:out |in )?(?:the|this|below) form|form link/i;

function detailsReply(r, cv, c) {
  const first = String(r.name || '').trim().split(/\s+/)[0];
  const hello = first && /^[A-Za-z][a-z]+$/.test(first) ? `Dear ${first},` : 'Dear Hiring Team,';
  const job0 = cv.experience[0] || {};
  const company = /^[A-Z0-9 .&-]+$/.test(job0.company || '') ? job0.company.charAt(0) + job0.company.slice(1).toLowerCase().replace(/maxime/, 'Maxime') : job0.company;
  const rows = [
    ['Total experience', `${cv.totalExperienceYears} years`],
    ['Current company and role', [company, job0.role].filter(Boolean).join(', ')],
    ['Current CTC', c.currentCtc],
    ['Expected CTC', c.expectedCtc],
    ['Notice period', c.notice],
    ['Last working day', c.lastWorkingDay],
    ['Current location', cv.location],
    ['Preferred location', c.preferredLocation],
    ['Interview availability', c.availability],
  ].filter(([, v]) => v);
  return [
    hello,
    '',
    'Thank you for getting back to me. Please find my details below:',
    '',
    ...rows.map(([k, v]) => `- ${k}: ${v}`),
    '',
    `My updated CV is attached${cv.portfolio ? `, and my projects are at ${cv.portfolio}` : ''}. Please let me know the next steps.`,
  ].join('\n');
}

function startReplyWatcher({ appliedEmails, isDone, markDone, notify, log, cvLoader, cvPdf, everyMin = 15 }) {
  if (!gmail.user || !gmail.appPassword) return;
  async function poll() {
    try {
      for (const r of await findReplies(45, appliedEmails())) {
        if (isDone(`reply:${r.id}`)) continue;
        markDone(`reply:${r.id}`);
        log(`Reply (${r.kind}) from ${r.from}: ${r.subject.slice(0, 60)}`);
        if (r.kind !== 'bounce') markReplied(r.from); // no follow-up to companies that answered
        if (r.kind === 'bounce') { await notify(`⚠️ An application email bounced (address not found): ${r.text}`); continue; }
        if (r.kind === 'rejected') { await notify(`❌ Rejected by ${r.from}\n${r.subject.slice(0, 80)}`); continue; }
        const c = candidate;
        const canAuto = autoReply && c.currentCtc && c.expectedCtc && c.notice;
        const why = SENSITIVE.test(r.text) ? 'they ask for personal documents or numbers (PAN / Aadhaar / date of birth...)'
          : FORM.test(r.text) ? 'they sent a form to fill' : !ASKS.test(r.text) ? 'it is not a request for your details' : '';
        if (canAuto && !why) {
          try {
            const cv = cvLoader();
            const subject = /^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`;
            await sendEmail({ to: r.from, subject, body: detailsReply(r, cv, c), cv, pdfPath: await cvPdf(cv), pdfName: `${cv.name.replace(/\s+/g, '_')}_Resume.pdf`, inReplyTo: r.id });
            log(`Auto-replied to ${r.from} with details and CV`);
            await notify(`📩 *Recruiter replied* and I answered with your details and CV ✅\nFrom: ${r.from}\n${r.subject.slice(0, 90)}\n\n${r.text.slice(0, 300)}`);
            continue;
          } catch (e) {
            log(`Auto-reply to ${r.from} failed: ${e.message}`);
          }
        }
        await notify(`📩 *Recruiter replied* - please answer yourself${why ? ` (${why})` : canAuto ? '' : ' (add your CTC / notice details to .env to let me answer)'}\nFrom: ${r.from}\n${r.subject.slice(0, 90)}\n\n${r.text.slice(0, 450)}`);
      }
    } catch (e) {
      log(`Reply check: ${e.message}`);
    }
    setTimeout(poll, everyMin * 60000);
  }
  setTimeout(poll, 90 * 1000);
  log(`Reply watcher: checking Gmail for recruiter replies every ${everyMin} min`);
}

module.exports = { startReplyWatcher, findReplies };
