const { askJson } = require('./ai');
const { ruleTailor } = require('./tailor-rules');
const { mentions } = require('./ats');

// Words that upgrade seniority/scope beyond the CV. Text containing them is replaced by the CV's own wording.
const OVERCLAIM = /\b(?:led|lead(?:ing|s)?|managed|manag(?:ing|er)|mentor(?:ed|ing)?|architect(?:ed|ing)?|enterprise|team of|spearhead(?:ed)?|head(?:ed)?|expert in|core back-?end)\b/i;

const SYSTEM = `You are an expert technical recruiter and ATS resume writer.
You tailor a candidate's CV to one job posting so it passes ATS keyword filters and reads well to a human.

HARD RULES - breaking any of these makes the CV fraudulent:
1. Never add a skill, tool, technology, employer, project, degree, certification or number that is not in the master CV.
2. Skills may only be chosen from "allowed_skills", spelled exactly as given.
3. Rephrase bullets to mirror the job's wording where the underlying fact is the same (e.g. "RESTful APIs" -> "REST API integration"). Never change what was actually done.
4. Do not invent metrics or percentages. Only numbers already present in the master CV may appear.
5. If the job needs core skills the candidate lacks, say so honestly in fit_reason and lower fit_score. Do not hide the gap.
6. Never upgrade seniority or scope: no "led", "lead", "managed", "mentored", "architected", "enterprise", "team of". Keep the CV's level of each skill, e.g. Node.js is "foundational / hands-on exposure", not core backend work.
7. Only connect a technology to a project if the master CV says so for that project. The email must follow the same rules as the CV.

ATS best practice: use the job's exact keyword spelling where truthful, put the most relevant skills and projects first, start bullets with strong action verbs, keep bullets to one or two lines, keep the summary to 2-3 lines and include the target job title if the candidate genuinely fits it.`;

const SHAPE = `Return JSON exactly like:
{
 "fit_score": 0,
 "fit_reason": "2-3 sentences: why this candidate does or doesn't fit, naming any missing must-have skills",
 "role_match": true,
 "headline": "job-title line for the CV header, truthful, e.g. Angular Frontend Developer",
 "summary": "tailored 2-3 line professional summary",
 "skills": {"Category name": ["skill from allowed_skills", "..."]},
 "experience_bullets": ["rewritten bullets for the single experience entry, most relevant first, 4-6 bullets"],
 "projects": [{"name": "exact project name from master CV", "bullets": ["2-4 rewritten bullets"]}],
 "email_subject": "Application for <job title> - <candidate name>",
 "whatsapp_message": "2-4 line WhatsApp message to the recruiter introducing the candidate and saying the CV is attached"
}
fit_score 0-100: how well the candidate's REAL experience matches the role (tech stack, seniority, domain). role_match=false if the role is a different field entirely (e.g. Java backend, sales, QA-only, data science).
Order projects most relevant first; include only projects that help (at least 2).`;

async function tailorCv(cv, job) {
  const allowedSkills = [...Object.values(cv.skills).flat(), ...(cv.extraKnownSkills || [])];
  const user = `${SHAPE}

JOB POSTING:
${JSON.stringify({ ...job, summary: undefined, parsedBy: undefined })}

MASTER CV:
${JSON.stringify({ ...cv, email: undefined, phone: undefined, linkedin: undefined })}

allowed_skills: ${JSON.stringify(allowedSkills)}`;

  const raw = await askJson({ system: SYSTEM, user, patient: false });
  return sanitize(raw, cv, job, allowedSkills);
}

// ---------- guards: the model is instructed not to lie, this enforces it ----------

function numbersIn(s) {
  return String(s).match(/\d+(\.\d+)?/g) || [];
}


function sanitize(raw, cv, job, allowedSkills) {
  const masterText = JSON.stringify(cv);
  const masterNumbers = new Set(numbersIn(masterText));
  const masterLower = masterText.toLowerCase();
  // no invented numbers, and no seniority words the CV doesn't already use
  const noInventedNumbers = (s) => numbersIn(s).every((n) => masterNumbers.has(n))
    && !(OVERCLAIM.test(s) && !masterLower.includes(String(s).match(OVERCLAIM)[0].toLowerCase()));
  const cleanList = (arr) => (Array.isArray(arr) ? arr.map(String).map((s) => s.trim()).filter(Boolean) : []);

  // Skills: exact matches from the allowed list only.
  const allowedByLower = new Map(allowedSkills.map((s) => [s.toLowerCase(), s]));
  const skills = {};
  for (const [cat, list] of Object.entries(raw.skills || {})) {
    const kept = [...new Set(cleanList(list).map((s) => allowedByLower.get(s.toLowerCase())).filter(Boolean))];
    if (kept.length) skills[cat] = kept;
  }
  const finalSkills = Object.keys(skills).length ? skills : structuredClone(cv.skills);
  // ATS: every skill the job asks for that the candidate really has must be printed on the CV.
  const jobText = [job.title, ...(job.keywords || []), ...(job.responsibilities || [])].join('\n');
  const printed = new Set(Object.values(finalSkills).flat().map((x) => x.toLowerCase()));
  const firstCat = Object.keys(finalSkills)[0];
  for (const x of allowedSkills) {
    if (!printed.has(x.toLowerCase()) && !(cv.skills.Languages || []).includes(x) && mentions(jobText, x)) finalSkills[firstCat].push(x);
  }
  // Keep spoken languages if the model dropped them.
  if (cv.skills.Languages && !Object.values(finalSkills).flat().some((s) => cv.skills.Languages.includes(s))) {
    finalSkills.Languages = cv.skills.Languages;
  }

  let expBullets = cleanList(raw.experience_bullets).filter(noInventedNumbers);
  if (expBullets.length < 3) expBullets = cv.experience[0].bullets;

  const masterProjects = new Map(cv.projects.map((p) => [p.name.toLowerCase(), p]));
  const projects = [];
  for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
    const master = p && masterProjects.get(String(p.name).toLowerCase().trim());
    if (!master || projects.some((x) => x.name === master.name)) continue;
    const bullets = cleanList(p.bullets).filter(noInventedNumbers);
    projects.push({ name: master.name, bullets: bullets.length ? bullets : master.bullets });
  }
  if (projects.length < 2) for (const p of cv.projects) if (!projects.some((x) => x.name === p.name)) projects.push(p);

  const summary = raw.summary && noInventedNumbers(raw.summary) ? String(raw.summary).trim() : cv.summary;
  const headline = /angular|front[\s-]?end|ui|web|software|javascript|typescript|full[\s-]?stack/i.test(raw.headline || '')
    && !/senior|lead|architect|manager|principal/i.test(raw.headline || '')
    ? String(raw.headline).trim()
    : cv.title;

  return {
    fitScore: Math.max(0, Math.min(100, Number(raw.fit_score) || 0)),
    fitReason: String(raw.fit_reason || ''),
    roleMatch: raw.role_match !== false,
    cv: {
      ...cv,
      title: headline,
      summary,
      skills: finalSkills,
      experience: [{ ...cv.experience[0], bullets: expBullets }, ...cv.experience.slice(1)],
      projects,
    },
    emailSubject: ruleTailor(cv, job).emailSubject,
    // The email is built from the CV's own bullets (rule-based): AI-written emails kept attaching
    // technologies to projects that the CV doesn't mention.
    emailBody: ruleTailor({ ...cv, experience: [{ ...cv.experience[0], bullets: expBullets }, ...cv.experience.slice(1)], projects }, job).emailBody,
    whatsappMessage: String(raw.whatsapp_message || '').trim(),
  };
}

module.exports = { tailorCv, sanitize };
