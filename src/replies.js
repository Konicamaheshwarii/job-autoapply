// Watches the Gmail inbox (read-only) for replies to the applications the bot sent, and tells the user on
// WhatsApp right away: recruiters usually only wait a day or two for the candidate to answer.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { gmail } = require('./config');

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
        if (REJECT.test(text)) out.push({ id, from, subject, text, kind: 'rejected' });
        else if (!noReply || /interview|shortlist|schedule|assessment/i.test(text)) { if (GOOD.test(text) || !noReply) out.push({ id, from, subject, text, kind: 'reply' }); }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return out;
}

function startReplyWatcher({ appliedEmails, isDone, markDone, notify, log, everyMin = 15 }) {
  if (!gmail.user || !gmail.appPassword) return;
  async function poll() {
    try {
      for (const r of await findReplies(45, appliedEmails())) {
        if (isDone(`reply:${r.id}`)) continue;
        markDone(`reply:${r.id}`);
        log(`Reply (${r.kind}) from ${r.from}: ${r.subject.slice(0, 60)}`);
        if (r.kind === 'bounce') await notify(`⚠️ An application email bounced (address not found): ${r.text}`);
        else if (r.kind === 'rejected') await notify(`❌ Rejected by ${r.from}\n${r.subject.slice(0, 80)}`);
        else await notify(`📩 *Recruiter replied* - answer today!\nFrom: ${r.from}\n${r.subject.slice(0, 90)}\n\n${r.text.slice(0, 450)}`);
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
