// No-AI CV tailoring: reorders what is already in the CV so the job's keywords come first,
// and fills a simple cover email. Used when AI is not needed or not available.
const { keywordScore, canonical, mentions } = require('./ats');

function hits(text, jobKeywords) {
  return keywordScore(jobKeywords, text).matched.length;
}

// Stable sort by keyword hits, highest first.
function byRelevance(items, toText, jobKeywords) {
  return items
    .map((item, i) => ({ item, i, h: hits(toText(item), jobKeywords) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.item);
}

// "Angular 16+", "Angular 19 and above"... -> show Signals / Standalone Components experience.
function wantsModernAngular(job) {
  const text = [job.title, job.summary, ...(job.responsibilities || []), job.raw || ''].join(' ');
  return /angular\s*v?(1[6-9]|[2-9]\d)\b/i.test(text);
}

const listJoin =(a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// Offer an in-person interview only when the job is in the candidate's own city.
// Remote jobs, jobs in other cities and jobs with no location get phone/video only.
function interviewOffer(cv, job) {
  const home = String(cv.location || '').split(',')[0].trim().toLowerCase();
  const where = String(job.location || '').toLowerCase();
  const local = home && where.includes(home) && job.work_mode !== 'remote';
  return local ? 'a call or in-person interview' : 'a call or video interview';
}

function ruleTailor(cv, job) {
  const kw = job.keywords || [];
  const cvSkills = [...Object.values(cv.skills).flat(), ...(cv.extraKnownSkills || [])];
  // Skills the job asks for that the CV really has, in the CV's own spelling.
  // Checked as "does the job mention this skill", so "Angular Material" doesn't match a plain "Angular" job.
  const jobText = [job.title, ...kw, ...(job.responsibilities || [])].join('\n');
  const jobWants = (skill) => mentions(jobText, skill) || (wantsModernAngular(job) && /signals|standalone/i.test(skill));
  const matchedSkills = cvSkills.filter((s) => !(cv.skills.Languages || []).includes(s) && jobWants(s));
  const top = [...new Set(matchedSkills)].slice(0, 5);

  const skills = {};
  for (const [cat, list] of Object.entries(cv.skills)) skills[cat] = byRelevance(list, (s) => s, kw);
  // Surface matching extra skills (e.g. SSR) in the first category.
  const firstCat = Object.keys(skills)[0];
  const listed = new Set(Object.values(skills).flat().map((s) => canonical(s)));
  const cats = Object.keys(skills);
  const catFor = (s) => {
    const want = /mongo|express|sql|docker|aws|node|api/i.test(s) ? /back|cloud|server/i
      : /test|jest|karma|jasmine|git|ci\/cd/i.test(s) ? /devops|tool|test/i : null;
    return (want && cats.find((c) => want.test(c))) || firstCat;
  };
  for (const s of cv.extraKnownSkills || []) if (jobWants(s) && !listed.has(canonical(s))) skills[catFor(s)].push(s);

  const titleOk = job.title && job.title.length <= 50
    && /angular|front[\s-]?end|\bui\b|web|javascript|typescript|software/i.test(job.title)
    && !/senior|\bsr\b|lead|architect|manager|principal|java(?!script)|\.net|react|php|python/i.test(job.title);
  const title = titleOk ? job.title.replace(/\s+/g, ' ').trim() : cv.title;

  const summary = top.length
    ? `${cv.summary} Core strengths include ${listJoin(top)}.`
    : cv.summary;

  const exp = cv.experience.map((e) => ({ ...e, bullets: byRelevance(e.bullets, (b) => b, kw) }));
  const projects = byRelevance(cv.projects, (p) => [p.name, ...p.bullets].join(' '), kw)
    .map((p) => ({ ...p, bullets: byRelevance(p.bullets, (b) => b, kw) }));

  const at = job.company ? ` at ${job.company}` : '';
  const role = job.title || 'the open';
  const strengths = top.length ? listJoin(top.slice(0, 4)) : 'Angular, TypeScript and REST API integration';
  const years = `${Math.floor(cv.totalExperienceYears)}+`;

  return {
    fitScore: null,
    fitReason: 'rule-based match (no AI used)',
    roleMatch: true,
    cv: { ...cv, title, summary, skills, experience: exp, projects },
    // Recruiters filter on the subject: role + years + name up front.
    emailSubject: `Application for ${role} | ${cv.totalExperienceYears} Yrs Exp | ${cv.name}`,
    emailBody:
`Dear Hiring Team,

I would like to apply for the ${role} position${at}. I have ${years} years of experience in ${strengths}. My CV is attached, and I am available for ${interviewOffer(cv, job)}.`,
    whatsappMessage:
`Hello, I'm ${cv.name}, an ${cv.title} with ${years} years of experience (${strengths}). I'd like to apply for the ${role} role${at}. Please find my CV attached. Thank you!`,
  };
}

module.exports = { ruleTailor, wantsModernAngular, interviewOffer };
