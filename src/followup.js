// One polite follow-up email, in the same thread as the application, when a company has not replied after a few days.
// Companies that replied (even with a rejection) never get one, and each application gets at most one follow-up.
const fs = require('fs');
const { followUp, gmail } = require('./config');
const { sendEmail } = require('./mailer');
const store = require('./store');

function followUpText(a, cv) {
  const at = a.company ? ` at ${a.company}` : '';
  const when = new Date(a.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  return [
    'Dear Hiring Team,',
    '',
    `I am following up on my application for the ${a.title} position${at}, sent on ${when}. I am still very interested in the role and would be glad to discuss how my ${cv.totalExperienceYears} years of experience with Angular, the MEAN stack and AI-powered features can help your team.`,
    '',
    `My CV is attached again for convenience${cv.portfolio ? `, and my projects are at ${cv.portfolio}` : ''}. Thank you for your time, and I look forward to hearing from you.`,
  ].join('\n');
}

/** Checks every 2 hours between 10:00 and 18:00 and sends the follow-ups that are due. */
function startFollowUps({ cvLoader, notify, log }) {
  if (!followUp.enabled || !gmail.user) return;
  let sentDay = '';
  let sentCount = 0;
  async function tick() {
    const now = new Date();
    const day = now.toDateString();
    if (day !== sentDay) { sentDay = day; sentCount = 0; }
    if (now.getHours() >= 10 && now.getHours() < 18) {
      const cv = cvLoader();
      for (const a of store.dueFollowUps(followUp.afterDays)) {
        if (sentCount >= followUp.maxPerDay) break;
        if (a.pdf && !fs.existsSync(a.pdf)) a.pdf = null;
        try {
          const subject = /^re:/i.test(a.subject) ? a.subject : `Re: ${a.subject}`;
          await sendEmail({ to: a.email, subject, body: followUpText(a, cv), cv, pdfPath: a.pdf, pdfName: a.pdfName, inReplyTo: a.messageId });
          store.markFollowedUp(a);
          sentCount++;
          log(`Follow-up sent to ${a.email} (${a.title})`);
          await notify(`🔁 Follow-up sent to ${a.email}\n${a.title}${a.company ? ` @ ${a.company}` : ''} (no reply in ${followUp.afterDays} days)`);
          await new Promise((r) => setTimeout(r, 60000 + Math.random() * 60000)); // space them out
        } catch (e) {
          log(`Follow-up to ${a.email} failed: ${e.message}`);
        }
      }
    }
    setTimeout(tick, 2 * 3600 * 1000);
  }
  setTimeout(tick, 5 * 60 * 1000);
  log(`Follow-ups: one email after ${followUp.afterDays} days without a reply, at most ${followUp.maxPerDay} a day`);
}

module.exports = { startFollowUps, followUpText };
