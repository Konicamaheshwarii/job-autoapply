const nodemailer = require('nodemailer');
const { gmail } = require('./config');

let transporter;

function getTransporter() {
  if (!gmail.user || !gmail.appPassword) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD missing in .env');
  transporter ??= nodemailer.createTransport({ service: 'gmail', auth: { user: gmail.user, pass: gmail.appPassword } });
  return transporter;
}

function signature(cv) {
  return `\n\nBest regards,\n${cv.name}\n${cv.phone}\n${cv.email}\n${cv.linkedin}`;
}

async function sendApplication({ to, subject, body, cv, pdfPath, pdfName }) {
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
