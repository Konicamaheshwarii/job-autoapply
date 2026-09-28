// Deterministic ATS-style keyword scoring: which of the job's required skills
// literally appear in the CV text. Real ATS filters work much like this, so the
// same check is run again on the tailored CV to show the improvement.

const SYNONYMS = {
  javascript: ['js', 'javascript', 'es6', 'es6+', 'ecmascript'],
  typescript: ['ts', 'typescript'],
  angular: ['angular', 'angularjs', 'angular js', 'angular.js', 'angular 2+', 'angular2'],
  'node.js': ['node', 'nodejs', 'node js', 'node.js'],
  'rest api': ['rest', 'rest api', 'rest apis', 'restful', 'restful api', 'restful apis', 'api integration'],
  html: ['html', 'html5'],
  css: ['css', 'css3'],
  'tailwind css': ['tailwind', 'tailwindcss', 'tailwind css'],
  'angular material': ['angular material', 'material design'],
  'ci/cd': ['ci/cd', 'cicd', 'ci cd', 'github actions'],
  git: ['git', 'github', 'version control'],
  ssr: ['ssr', 'server side rendering', 'server-side rendering', 'angular universal'],
  jwt: ['jwt', 'jwt authentication', 'json web token'],
  'responsive design': ['responsive', 'responsive design', 'responsive ui', 'mobile first'],
  rxjs: ['rxjs', 'reactive programming'],
  ngrx: ['ngrx', 'state management'],
  bootstrap: ['bootstrap'],
  scss: ['scss', 'sass'],
  mongodb: ['mongodb', 'mongo', 'mongo db'],
  'express.js': ['express', 'express.js', 'expressjs'],
  sql: ['sql', 'mysql', 'ms sql'],
  'unit testing': ['unit testing', 'unit test', 'unit tests'],
  'angular signals': ['signals', 'angular signals'],
  'standalone components': ['standalone components', 'standalone'],
};

const LOOKUP = new Map();
for (const [canon, list] of Object.entries(SYNONYMS)) for (const s of list) LOOKUP.set(s, canon);

function normalizeText(s) {
  return ` ${String(s).toLowerCase().replace(/[^a-z0-9+#./ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function canonical(term) {
  const t = String(term).toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s*v?\d+(\.\d+)*\+?$/, ''); // "Angular 17" -> "angular"
  if (LOOKUP.has(t)) return LOOKUP.get(t);
  // "REST API integration" -> "rest api": longest known phrase inside the term
  const padded = normalizeText(t);
  let best = null;
  for (const v of LOOKUP.keys()) if (v.length > 2 && padded.includes(normalizeText(v)) && (!best || v.length > best.length)) best = v;
  return best ? LOOKUP.get(best) : t;
}

// "HTML5/CSS3" -> ["HTML5", "CSS3"], but keep "CI/CD" whole.
function splitKeyword(k) {
  if (LOOKUP.has(canonical(k)) || !k.includes('/')) return [k];
  const parts = k.split('/').map((s) => s.trim()).filter(Boolean);
  return parts.every((p) => LOOKUP.has(canonical(p)) || SYNONYMS[canonical(p)]) ? parts : [k];
}

function cvToText(cv) {
  return [
    cv.title, cv.summary,
    ...Object.values(cv.skills).flat(),
    ...(cv.extraKnownSkills || []),
    ...cv.experience.flatMap((e) => [e.role, ...e.bullets]),
    ...cv.projects.flatMap((p) => [p.name, ...p.bullets]),
  ].join('\n');
}

function containsTerm(normText, canon) {
  const variants = SYNONYMS[canon] || [canon];
  return variants.some((v) => normText.includes(normalizeText(v)));
}

/** @returns {{score:number, matched:string[], missing:string[]}} */
function keywordScore(jobKeywords, cvText) {
  const keywords = [...new Set((jobKeywords || []).flatMap((k) => splitKeyword(String(k).trim())).filter(Boolean))];
  if (!keywords.length) return { score: 50, matched: [], missing: [] };
  const norm = normalizeText(cvText);
  const matched = [];
  const missing = [];
  for (const k of keywords) (containsTerm(norm, canonical(k)) ? matched : missing).push(k);
  return { score: Math.round((matched.length / keywords.length) * 100), matched, missing };
}

/** Does the text mention this exact skill (or a true synonym)? Stricter than keywordScore: "Angular CLI" != "Angular". */
function mentions(text, skill) {
  const t = String(skill).toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const variants = LOOKUP.has(t) ? SYNONYMS[LOOKUP.get(t)] : [t];
  const norm = normalizeText(text);
  return variants.some((v) => norm.includes(normalizeText(v)));
}

module.exports = { keywordScore, cvToText, canonical, mentions };
