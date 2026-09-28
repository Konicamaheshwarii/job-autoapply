// No-AI matching: is this job the candidate's kind of role, and how well does it score?
const { keywordScore } = require('./ats');

// Stacks that mean "a different job" when the post does not also ask for Angular.
const OTHER_STACKS = ['React', 'React Native', 'Next.js', 'Vue', '.NET', 'C#', 'Java', 'Spring Boot', 'Python', 'Django', 'Flask',
  'FastAPI', 'PHP', 'Laravel', 'WordPress', 'Shopify', 'Ruby', 'Go', 'Rust', 'Flutter', 'Dart', 'Android', 'iOS', 'Kotlin', 'Swift',
  'MuleSoft', 'Salesforce', 'SAP', 'Spark'];

const FRONTEND_TITLE = /front[\s-]?end|\bui\b|javascript|typescript|web developer|mean\b|web application/i;

/** @returns {{value:number, mismatch:string|null, why:string}} value 0..1 */
function roleFit(job) {
  const title = String(job.title || '');
  const kws = job.keywords || [];
  const hasAngular = /angular/i.test(title) || kws.some((k) => /angular/i.test(k));
  if (hasAngular) return { value: 1, mismatch: null, why: 'Angular role' };

  const others = OTHER_STACKS.filter((s) => kws.includes(s) || new RegExp(`(?<![a-z])${s.replace(/[.#+]/g, '\\$&')}(?![a-z])`, 'i').test(title));
  if (others.length) return { value: 0, mismatch: others.slice(0, 3).join(', '), why: `${others.slice(0, 3).join(', ')} role, not Angular` };

  if (FRONTEND_TITLE.test(title)) return { value: 0.6, mismatch: null, why: 'frontend/JS role' };
  return { value: 0.2, mismatch: null, why: 'role unclear' };
}

/** Score 0..100 without AI: 70% skill keyword coverage + 30% role fit. */
function ruleScore(job, cvText) {
  const kw = keywordScore(job.keywords, cvText);
  const fit = roleFit(job);
  return { score: Math.round(0.7 * kw.score + 30 * fit.value), kw, fit };
}

module.exports = { roleFit, ruleScore };
