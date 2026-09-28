// No-AI matching: is this job the candidate's kind of role, and how well does it score?
//   apply : Angular roles, and Full Stack / MEAN roles built on Angular (+ Node)
//   skip  : any other main stack (PHP, Java, .NET, Python, ServiceNow...), even if Angular is also mentioned
//   skip  : React/Vue-only roles, trainee/intern roles, and roles with no Angular/frontend signal at all
const { keywordScore } = require('./ats');

// Backend/platform stacks the candidate doesn't work in. Any of these in the job = not her job.
const BLOCKED = [
  ['.NET', /\.net\b|dot\s?net|asp\.net/i], ['C#', /c#|c sharp/i], ['Java', /\bjava\b(?!\s?script)/i], ['Spring Boot', /spring/i],
  ['PHP', /php/i], ['Laravel', /laravel/i], ['Python', /python/i], ['Django', /django/i], ['Flask', /flask/i], ['FastAPI', /fastapi/i],
  ['Ruby', /\bruby\b|rails/i], ['Go', /\bgolang\b/i], ['Rust', /\brust\b/i], ['WordPress', /wordpress/i], ['Shopify', /shopify/i],
  ['Salesforce', /salesforce/i], ['ServiceNow', /servicenow|service now/i], ['SAP', /\bsap\b/i], ['MuleSoft', /mulesoft/i],
  ['Flutter', /flutter/i], ['Dart', /\bdart\b/i], ['Android', /android/i], ['iOS', /\bios\b/i], ['Kotlin', /kotlin/i], ['Swift', /\bswift\b/i],
  ['Data Engineering', /data engineer|etl\b|pyspark|databricks|snowflake/i], ['QA', /\bqa\b|tester|testing engineer|automation test/i],
  ['DevOps', /devops engineer|site reliability|\bsre\b/i], ['Unity', /\bunity\b|game developer/i], ['Blockchain', /blockchain|solidity|web3/i],
];
// Frontend frameworks that compete with Angular: fine only if Angular is also asked for.
const OTHER_FRONTEND = [['React', /react(?!\s?native)/i], ['React Native', /react\s?native/i], ['Next.js', /next\.?js/i], ['Vue', /\bvue/i], ['Svelte', /svelte/i]];

const JUNIOR = /\b(?:trainee|intern(?:ship)?|freshers?|junior|jr\.?|entry[\s-]level|graduate engineer trainee)(?![a-z])/i;
const FRONTEND_TITLE = /front[\s-]?end|\bui\b|javascript|typescript|web developer|web application/i;
const FULLSTACK = /full[\s-]?stack|\bmean\b/i;

const found = (list, text) => list.filter(([, re]) => re.test(text)).map(([name]) => name);

/** @returns {{value:number, mismatch:string|null, why:string}} value 0..1; mismatch set = never apply */
function roleFit(job) {
  const title = String(job.title || '');
  const text = [title, ...(job.keywords || [])].join(' | ');
  const hasAngular = /angular/i.test(text);
  const hasNode = /node/i.test(text);

  const blocked = found(BLOCKED, text);
  if (blocked.length) return { value: 0, mismatch: blocked.slice(0, 3).join(', '), why: `${blocked.slice(0, 3).join(', ')} role` };

  // No trainee/intern/fresher roles, and nothing capped below 3 years ("0-2 yrs").
  if (JUNIOR.test(title) || /\bfreshers?\b/i.test(job.summary || '') && job.experience_min == null
    || (job.experience_max != null && job.experience_max < 3)) {
    return { value: 0, mismatch: 'junior', why: 'trainee/fresher/junior role, too junior for your experience' };
  }

  const otherFe = found(OTHER_FRONTEND, text);
  if (!hasAngular && otherFe.length) return { value: 0, mismatch: otherFe.join(', '), why: `${otherFe.slice(0, 2).join(', ')} role, not Angular` };

  if (hasAngular && FULLSTACK.test(title)) {
    return hasNode
      ? { value: 1, bonus: 10, mismatch: null, why: 'Full Stack Angular + Node role' }
      : { value: 0.8, mismatch: null, why: 'Full Stack Angular role' };
  }
  if (hasAngular) return { value: 1, mismatch: null, why: 'Angular role' };
  if (FRONTEND_TITLE.test(title)) return { value: 0.6, mismatch: null, why: 'frontend/JS role' };
  if (FULLSTACK.test(title) && hasNode) return { value: 0.6, mismatch: null, why: 'Full Stack Node role' };
  return { value: 0, mismatch: 'unclear', why: 'no Angular/frontend in the job' };
}

/** Score 0..100 without AI: 70% skill keyword coverage + 30% role fit. */
function ruleScore(job, cvText) {
  const kw = keywordScore(job.keywords, cvText);
  const fit = roleFit(job);
  // Full Stack Angular+Node posts list many backend tools (MongoDB, Express...), so they get a small boost.
  return { score: Math.min(100, Math.round(0.7 * kw.score + 30 * fit.value + (fit.bonus || 0))), kw, fit };
}

module.exports = { roleFit, ruleScore };
