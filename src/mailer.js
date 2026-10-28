const nodemailer = require('nodemailer');
const { gmail } = require('./config');

let transporter;

function getTransporter() {
  if (!gmail.user || !gmail.appPassword) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD missing in .env');
  transporter ??= nodemailer.createTransport({ service: 'gmail', family: 4, auth: { user: gmail.user, pass: gmail.appPassword } });
  return transporter;
}

function signature(cv) {
  const links = [
    cv.portfolio && `Portfolio: ${cv.portfolio}`,
    cv.github && `GitHub: ${cv.github}`,
    cv.linkedin && `LinkedIn: ${cv.linkedin}`,
  ].filter(Boolean).join('\n');
  return `\n\nBest regards,\n${cv.name}\n${cv.phone}\n${cv.email}\n${links}`;
}

const isNetworkError = (e) => /ENETUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ESOCKET|Connection timeout/i.test(`${e && e.code} ${e && e.message}`);

// Wi-Fi often isn't back yet right after the PC wakes up, so retry a few times before giving up.
async function sendApplication(args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendOnce(args);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      if (attempt === 3) { e.network = true; throw e; }
      await new Promise((r) => setTimeout(r, attempt * 30000));
    }
  }
}

async function sendOnce({ to, subject, body, cv, pdfPath, pdfName }) {
  return getTransporter().sendMail({
    from: `"${cv.name}" <${gmail.user}>`,
    replyTo: cv.email,
    to,
    subject,
    text: body + signature(cv),
    attachments: [{ filename: pdfName, path: pdfPath, contentType: 'application/pdf' }],
  });
}

/**
 * Any other email from the candidate (recruiter replies, follow-ups). With inReplyTo it stays in the same thread.
 * Retries on network errors like sendApplication.
 */
async function sendEmail({ to, subject, body, cv, pdfPath, pdfName, inReplyTo }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getTransporter().sendMail({
        from: `"${cv.name}" <${gmail.user}>`,
        replyTo: cv.email,
        to,
        subject,
        text: body + signature(cv),
        ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
        attachments: pdfPath ? [{ filename: pdfName || 'CV.pdf', path: pdfPath, contentType: 'application/pdf' }] : [],
      });
    } catch (e) {
      if (!isNetworkError(e) || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, attempt * 30000));
    }
  }
}

async function verifyMailer() {
  await getTransporter().verify();
}

// Plain alert to yourself (e.g. WhatsApp needs a QR re-scan), because WhatsApp itself can't be used to tell you that.
async function alertSelf(subject, text) {
  await getTransporter().sendMail({ from: gmail.user, to: gmail.user, subject, text });
}

// A typo'd domain bounces back to the inbox and looks bad, so check that the domain can receive mail first.
// Only a definite "no such domain" blocks the send; DNS trouble on our side does not.
async function domainCanReceive(email) {
  const dns = require('dns').promises;
  const domain = String(email).split('@')[1];
  if (!domain) return false;
  try {
    return (await dns.resolveMx(domain)).length > 0;
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      try { return (await dns.resolve4(domain)).length > 0; } catch (e2) { return !(e2.code === 'ENOTFOUND' || e2.code === 'ENODATA'); }
    }
    return true;
  }
}

module.exports = { sendApplication, sendEmail, verifyMailer, signature, alertSelf, domainCanReceive };
