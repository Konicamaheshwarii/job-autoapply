// Rule-based job post parser: no AI, no tokens. Handles the usual WhatsApp format
// ("Hiring: X Developer ... Experience: 3-5 yrs ... Skills: ... Send CV to hr@...").
const { normalizePhone, validEmail } = require('./extract');

// Tech terms we look for in posts. [display name, ...regex sources]
const TECH = [
  ['Angular', 'angular(?:\\s?js)?'], ['TypeScript', 'typescript', '\\bts\\b'], ['JavaScript', 'javascript', 'java script', '\\bjs\\b', 'es6'],
  ['HTML', 'html5?'], ['CSS', 'css3?'], ['SCSS', 'scss', 'sass'], ['Tailwind CSS', 'tailwind'], ['Bootstrap', 'bootstrap'],
  ['Angular Material', 'angular material'], ['RxJS', 'rxjs'], ['NgRx', 'ngrx'], ['Redux', 'redux'],
  ['React', 'react(?:\\.?js)?(?!\\s?native)'], ['React Native', 'react\\s?native'], ['Next.js', 'next\\.?js'], ['Vue', 'vue(?:\\.?js)?'],
  ['Node.js', 'node(?:\\.?\\s?js)?'], ['Express', 'express(?:\\.?js)?'], ['NestJS', 'nest\\.?js'],
  ['REST APIs', 'rest(?:ful)?\\s?api', 'web services'], ['GraphQL', 'graphql'], ['JWT', 'jwt'], ['Microservices', 'micro-?services'],
  ['.NET', '\\.net', 'dot\\s?net', 'asp\\.net'], ['C#', 'c#', 'c sharp'], ['Java', 'java(?!\\s?script)'], ['Spring Boot', 'spring'],
  ['Python', 'python'], ['Django', 'django'], ['Flask', 'flask'], ['FastAPI', 'fastapi'], ['PHP', 'php'], ['Laravel', 'laravel'],
  ['WordPress', 'wordpress'], ['Shopify', 'shopify'], ['Ruby', 'ruby'], ['Go', 'golang'], ['Rust', 'rust'],
  ['Flutter', 'flutter'], ['Dart', 'dart'], ['Android', 'android'], ['iOS', 'ios'], ['Kotlin', 'kotlin'], ['Swift', 'swift'],
  ['SQL', 'sql', 'mysql', 'postgres(?:ql)?', 'ms sql'], ['MongoDB', 'mongo(?:db)?'], ['Redis', 'redis'], ['Firebase', 'firebase'],
  ['AWS', 'aws'], ['Azure', 'azure'], ['GCP', 'gcp', 'google cloud'], ['Docker', 'docker'], ['Kubernetes', 'kubernetes', 'k8s'],
  ['CI/CD', 'ci\\s?/\\s?cd', 'github actions', 'jenkins'], ['Git', 'git(?:hub|lab)?'],
  ['Jest', 'jest'], ['Karma', 'karma'], ['Jasmine', 'jasmine'], ['Cypress', 'cypress'], ['Unit Testing', 'unit test'],
  ['MuleSoft', 'mulesoft', 'mule\\s?4'], ['Salesforce', 'salesforce'], ['ServiceNow', 'servicenow', 'service now'],
  ['Svelte', 'svelte'], ['Unity', 'unity3d', 'unity'], ['Blockchain', 'blockchain', 'solidity', 'web3'], ['SAP', '\\bsap\\b'], ['Kafka', 'kafka'], ['Spark', 'spark'],
  ['Figma', 'figma'], ['SSR', 'ssr', 'server[\\s-]side rendering', 'angular universal'], ['Responsive Design', 'responsive'],
  ['Agentic AI', 'agentic'], ['Generative AI', 'gen\\s?ai', 'generative ai', '\\bllm'],
].map(([name, ...src]) => [name, new RegExp(`(?<![a-z0-9])(?:${src.join('|')})(?![a-z0-9+#])`, 'i')]);

const HIRING = /\bhiring\b|we are looking|we're looking|looking for (?:an? )?(?:experienced |skilled |talented )?[\w.#+ /-]{0,40}(?:developer|engineer)|job opening|opening for|vacanc|urgent(?:ly)? (?:requirement|hiring)|walk[\s-]?in|share (?:your )?(?:cv|resume)|send (?:your )?(?:cv|resume)|position\s*:|role\s*:|job title\s*:|requirement for/i;
const SEEKER = /\bi am looking for\b|\bi'm looking for\b|looking for (?:a )?(?:job|opportunit|change)|open to work|#opentowork|my resume|immediate joiner looking/i;
const ROLE_WORD = /(developer|engineer|architect|programmer|designer|intern|lead|tester|analyst|consultant|specialist|administrator|devops|sde\b)/i;

const clean = (s) => String(s || '')
  .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ') // emojis
  .replace(/[*_~`]/g, '') // WhatsApp formatting
  .replace(/\s+/g, ' ')
  .trim();

function findTitle(lines) {
  const labelled = lines.map((l) => l.match(/^(?:job\s*title|position|role|designation|opening)\s*[:\-–]\s*(.+)$/i)).find(Boolean);
  let t = labelled ? labelled[1] : lines.find((l) => ROLE_WORD.test(l));
  if (!t) return null;
  t = t.replace(/^.*?\b(?:hiring|opening|looking for|vacancy)\b\s*(?:for|an?|:|\||-|–)*\s*/i, '') // "We're Hiring: X" -> "X"
    .replace(/^(?:an?|the)\s+/i, '')
    .split(/\s[|–—]\s|\s-\s|\s@\s|\(|📍/)[0]
    .replace(/[:.!,\s-]+$/, '')
    .trim();
  const m = t.match(new RegExp(`^(.{0,60}?${ROLE_WORD.source})`, 'i'));
  if (m) t = m[1];
  return t.length >= 3 ? t : null;
}

function findExperience(text) {
  const t = text.toLowerCase();
  if (/\bfreshers?\b/.test(t) && !/\d+\s*\+?\s*(?:yrs?|years?)/.test(t)) return [0, 1];
  let m = t.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:-|–|to)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:yrs?|years?)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = t.match(/(?:min(?:imum)?|at least|atleast)\s*(\d{1,2})\s*\+?\s*(?:yrs?|years?)/) || t.match(/(\d{1,2})\s*\+\s*(?:yrs?|years?)/)
    || t.match(/experience\s*[:\-–]?\s*(\d{1,2})\s*(?:yrs?|years?)/) || t.match(/(\d{1,2})\s*(?:yrs?|years?)\s*(?:of\s*)?(?:exp|experience)/);
  if (m) return [Number(m[1]), null];
  return [null, null];
}

function field(lines, names) {
  const re = new RegExp(`^(?:${names})\\s*[:\\-–]\\s*(.+)$`, 'i');
  const hit = lines.map((l) => l.match(re)).find(Boolean);
  return hit ? hit[1].trim() : null;
}

/** @returns {object|null} job in the same shape the AI extractor returns, or null if not a hiring post */
function parseJobPost(raw) {
  const text = String(raw || '');
  if (text.length < 40 || SEEKER.test(text) || !HIRING.test(text)) return null;
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const flat = clean(text);

  const title = findTitle(lines);
  if (!title) return null;

  const keywords = TECH.filter(([, re]) => re.test(flat)).map(([name]) => name);
  // "Angular Material"/"React Native" also match their parent regexes only when really present
  const [expMin, expMax] = findExperience(flat);

  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(validEmail).filter(Boolean))];
  const phones = [...new Set((text.match(/(?:\+?91[\s-]?)?[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g) || [])
    .map(normalizePhone).filter(Boolean))];
  const link = (text.match(/https?:\/\/[^\s)]+/i) || [])[0] || null;

  const company = field(lines, 'company(?: name)?|organi[sz]ation|client')
    || (flat.match(/\bwe at ([A-Z][\w&.\- ]{1,40}?) (?:are|is)\b/i) || [])[1]
    // "Dove Soft Ltd. is looking for..." at the start of a line
    || lines.map((l) => (l.match(/^([A-Z][\w&.\-]*(?: [A-Z][\w&.\-]*){0,4}) (?:is|are) (?:hiring|looking)\b/) || [])[1])
      .find((c) => c && !/^(?:we|our|i|you|they|us)\b/i.test(c))
    || null;
  const location = field(lines, 'location|job location|work location|📍') || null;
  const workMode = /\bremote\b|work from home|\bwfh\b/i.test(flat) ? 'remote' : /\bhybrid\b/i.test(flat) ? 'hybrid' : location ? 'onsite' : null;
  const BULLET = /^\s*(?:[-•*▪➢✅✔→>]|\d+[.)])\s*/u;
  const responsibilities = text.split(/\r?\n/).filter((l) => BULLET.test(l))
    .map((l) => clean(l.replace(BULLET, ''))).filter((l) => l.length > 3).slice(0, 8);

  return {
    title,
    company: company ? company.replace(/[.,]$/, '') : null,
    location,
    work_mode: workMode,
    experience_min: expMin,
    experience_max: expMax,
    keywords,
    responsibilities,
    apply_email: emails[0] || null,
    apply_whatsapp: emails.length ? null : phones[0] || null,
    apply_link: link,
    summary: flat.slice(0, 160),
    parsedBy: 'rules',
  };
}

module.exports = { parseJobPost };
