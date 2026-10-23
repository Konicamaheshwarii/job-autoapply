// Parsers for job emails from Indeed, Naukri and Foundit. Each returns [{title, company, location, link}].
// (LinkedIn alerts are parsed in alerts.js.) Links are the platforms' own tracking links: the user clicks them to apply.
const decode = (t) => String(t).replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();
const strip = (h) => String(h).replace(/<(?:br|\/p|\/div|\/tr|\/td|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&emsp;|&#8203;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
const lines = (h) => strip(h).split('\n').map((l) => l.trim()).filter(Boolean);

const anchors = (html) => [...String(html).matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  .map((m) => ({ href: decode(m[1]), text: lines(m[2]).join(' ').trim(), end: m.index + m[0].length }));

// Buttons, footer links and promo lines that are not job details
const UI = /view (?:all )?job|bad match|learn more|^yes$|^no$|edit profile|pause|help|^indeed$|privacy|terms|unsubscribe|find jobs|sign in|manage|apply now|get app|report|feedback|jobs$|view job|apply|ago$|applicant|easily|promoted|actively|^\W*$/i;

/** Indeed job alerts and "match" mails: job titles are the links to /rc/clk, /pagead/clk or the cts redirect. */
function jobsFromIndeed(html) {
  const as = anchors(html).filter((a) => /indeed\.com\/(?:rc|pagead)\/clk|cts\.indeed\.com/.test(a.href) && /[a-z]{3}/i.test(a.text) && !UI.test(a.text));
  const seen = new Set();
  const uniq = as.filter((a) => !seen.has(a.text) && seen.add(a.text));
  return uniq.map((a, i) => {
    const next = uniq[i + 1];
    const after = lines(String(html).slice(a.end, next ? next.end - 200 : a.end + 1500)).filter((l) => !UI.test(l));
    const m = (after[0] || '').match(/^(.+?)\s+-\s+(.+)$/);
    return { title: a.text, company: m ? m[1] : after[0] || null, location: m ? m[2] : after[1] || null, link: a.href };
  });
}

/** Naukri recruiter mails: subject is "✉️ Job | <title>_<company> in <city>". The apply button needs a Naukri login. */
function jobsFromNaukri(subject) {
  const rest = String(subject).replace(/^[^|]*\|\s*/, '');
  const m = rest.match(/^(.+?)\s+in\s+(.+)$/i);
  const head = m ? m[1] : rest;
  const [title, company] = head.split('_');
  return title && title.trim() ? [{ title: title.trim(), company: company ? company.trim() : null, location: m ? m[2].trim() : null, link: 'https://www.naukri.com/mnjuser/homepage' }] : [];
}

/** Foundit invites: "You're invited to apply for the <title> role at <company>". */
function jobsFromFoundit(subject, html) {
  const m = decode(subject).match(/apply for (?:the )?(.+?)\s+role at\s+(.+)$/i);
  if (!m) return [];
  const apply = anchors(html).find((a) => /apply now/i.test(a.text));
  return [{ title: m[1].trim(), company: m[2].trim(), location: null, link: apply ? apply.href : 'https://www.foundit.in/' }];
}

const PLATFORM_SENDERS = ['linkedin.com', 'indeed.com', 'naukri.com', 'foundit.in', 'monsterindia.com'];

/** @returns {{platform:string, jobs:object[]}|null} null when the sender is not a known job platform */
function parseByPlatform(mail) {
  const from = mail.from || '';
  if (/indeed\.com/.test(from)) return { platform: 'Indeed', jobs: jobsFromIndeed(mail.html) };
  if (/naukri\.com/.test(from)) return { platform: 'Naukri', jobs: jobsFromNaukri(mail.subject) };
  if (/foundit\.in|monsterindia\.com/.test(from)) return { platform: 'Foundit', jobs: jobsFromFoundit(mail.subject, mail.html) };
  return null;
}

module.exports = { PLATFORM_SENDERS, parseByPlatform, jobsFromIndeed, jobsFromNaukri, jobsFromFoundit };
