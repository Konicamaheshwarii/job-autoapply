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
  // "Built and optimized CI/CD..." -> "built and optimized CI/CD..."
  const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, '');
  const doneList = exp[0].bullets.slice(0, 3).map((b) => `- I ${lower1(b)}.`).join('\n');
  const [p1, p2] = projects;
  const projectLine = [p1, p2].filter(Boolean)
    .map((p) => `${p.name}, where I ${lower1(p.bullets[0]).replace(new RegExp(`^(developed(?: and (?:maintained|implemented))?) ${p.name},? `, 'i'), '$1 ')}`)
    .join('; and ');

  return {
    fitScore: null,
    fitReason: 'rule-based match (no AI used)',
    roleMatch: true,
    cv: { ...cv, title, summary, skills, experience: exp, projects },
    // Recruiters filter on the subject: role + years + name up front.
    emailSubject: `Application for ${role} | ${cv.totalExperienceYears} Yrs Exp | ${cv.name}`,
    emailBody:
`Dear Hiring Team,

I am writing to apply for the ${role} position${at}. I am an ${cv.title} with ${years} years of experience, currently working at ${cv.experience[0].company}, where I build and maintain scalable, user-focused web applications using ${strengths}.

In my current role, the work most relevant to this position includes:
${doneList}

I have also worked on ${projectLine}. These projects gave me hands-on experience taking features from requirement to production and working closely with clients and team members.

I have attached my CV for your review. I would welcome the opportunity to discuss how my experience can contribute to your team, and I am available for a call or interview at your convenience.`,
    whatsappMessage:
`Hello, I'm ${cv.name}, an ${cv.title} with ${years} years of experience (${strengths}). I'd like to apply for the ${role} role${at}. Please find my CV attached. Thank you!`,
  };
}

module.exports = { ruleTailor, wantsModernAngular };
