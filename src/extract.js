const { askJson } = require('./ai');

const SYSTEM = `You read messages from a WhatsApp job-openings group and extract structured job postings.
Rules:
- Only real hiring posts count. Ignore chit-chat, candidates looking for jobs, course/training ads, "DM for referral" spam, and paid placement offers.
- One message can contain several openings; return each one separately.
- "keywords" = hard, technical skills/tools/frameworks the role requires (e.g. "Angular", "RxJS", "AWS"). No soft skills, no generic words like "coding".
- Experience in years as numbers. "Fresher" = 0. Unknown = null.
- apply_email: the email to send the CV to. apply_whatsapp: phone number to send the CV to on WhatsApp, digits only with country code if given. apply_link: a form/portal URL if that is the only way to apply. null when absent. Never invent contact details.
- Keep the original wording for title and company. Use null for unknown fields.`;

const SHAPE = `Return JSON exactly like:
{"jobs":[{"title":"","company":null,"location":null,"work_mode":"onsite|remote|hybrid|null","experience_min":null,"experience_max":null,"keywords":[],"responsibilities":[],"apply_email":null,"apply_whatsapp":null,"apply_link":null,"summary":"one-line summary"}]}
Return {"jobs":[]} if this is not a hiring post.`;

/**
 * @param {string} text message body / caption
 * @param {{mimetype:string,data:string}} [image] base64 poster image, if the post is an image
 */
async function extractJobs(text, image) {
  const user = `${SHAPE}\n\nMessage:\n"""\n${text || '(no text, see image)'}\n"""`;
  const out = await askJson({ system: SYSTEM, user, image, patient: true });
  const jobs = Array.isArray(out.jobs) ? out.jobs : [];
  return jobs
    .filter((j) => j && j.title)
    .map((j) => ({
      ...j,
      keywords: Array.isArray(j.keywords) ? j.keywords : [],
      responsibilities: Array.isArray(j.responsibilities) ? j.responsibilities : [],
      apply_email: validEmail(j.apply_email),
      apply_whatsapp: normalizePhone(j.apply_whatsapp),
    }));
}

function validEmail(e) {
  if (!e) return null;
  const m = String(e).trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

// Indian numbers without a country code get 91 prepended.
function normalizePhone(p) {
  if (!p) return null;
  let d = String(p).replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

module.exports = { extractJobs, normalizePhone, validEmail };
