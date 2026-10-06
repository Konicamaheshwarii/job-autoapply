const nodemailer = require('nodemailer');
const { gmail } = require('./config');

let transporter;

function getTransporter() {
  if (!gmail.user || !gmail.appPassword) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD missing in .env');
  transporter ??= nodemailer.createTransport({ service: 'gmail', family: 4, auth: { user: gmail.user, pass: gmail.appPassword } });
  return transporter;
}

function signature(cv) {
  return `\n\nBest regards,\n${cv.name}\n${cv.phone}\n${cv.email}\n${cv.linkedin}`;
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

async function verifyMailer() {
  await getTransporter().verify();
}

module.exports = { sendApplication, verifyMailer, signature };
