// Job posts from LinkedIn, Indeed, Naukri, Glassdoor and company sites through the JSearch API (RapidAPI),
// which collects them from Google for Jobs. Legal and read-only: no logging in to any job site.
// Free plan is about 200 requests a month, so the bot only runs a few searches a day.
const { jsearch } = require('./config');

const HOST = 'jsearch.p.rapidapi.com';
const TOO_SENIOR = /\b(?:lead|principal|architect|manager|head|director|staff|vp)\b/i;

async function search(query) {
  const params = new URLSearchParams({ query, num_pages: '1', date_posted: jsearch.datePosted, country: jsearch.country });
  const res = await fetch(`https://${HOST}/search?${params}`, {
    headers: { 'x-rapidapi-key': jsearch.key, 'x-rapidapi-host': HOST },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`JSearch ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  return Array.isArray(body.data) ? body.data : [];
}

/** The text handed to the pipeline: the apply link comes first so it is the link the parser picks up. */
function postText(j) {
  const where = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') + (j.job_is_remote ? ' (Remote)' : '');
  return [
    `Hiring: ${j.job_title}`,
    `Apply: ${j.job_apply_link || ''}`,
    j.employer_name && `Company: ${j.employer_name}`,
    where && `Location: ${where}`,
    '',
    String(j.job_description || '').slice(0, 3500),
    '',
    `(via ${j.job_publisher || 'JSearch'})`,
  ].filter((l) => l !== null && l !== undefined && l !== false).join('\n');
}

/** New jobs from all configured searches: [{text, source, key}] */
async function collectJobs({ log }) {
  const out = [];
  for (const q of jsearch.queries) {
    const jobs = await search(q);
    const fresh = jobs.filter((j) => j.job_title && !TOO_SENIOR.test(j.job_title));
    log(`JSearch "${q}": ${jobs.length} job(s), ${fresh.length} worth checking`);
    for (const j of fresh) {
      out.push({
        text: postText(j),
        source: `JSearch / ${j.job_publisher || 'web'}`,
        key: `jsearch:${j.job_id || `${j.job_title}|${j.employer_name}`}`.toLowerCase(),
      });
    }
  }
  return out;
}

/** Runs a search round every few hours during the day. */
function startJSearch({ onPost, log }) {
  if (!jsearch.key) return;
  let lastRun = 0;
  async function tick() {
    const hour = new Date().getHours();
    if (hour >= jsearch.fromHour && hour < jsearch.toHour && Date.now() - lastRun >= jsearch.everyHours * 3600 * 1000) {
      lastRun = Date.now();
      try {
        for (const p of await collectJobs({ log })) await onPost(p);
      } catch (e) {
        log(`JSearch: ${e.message}`);
      }
    }
    setTimeout(tick, 10 * 60 * 1000);
  }
  setTimeout(tick, 2 * 60 * 1000);
  log(`JSearch: ${jsearch.queries.length} search(es) every ${jsearch.everyHours} h, ${jsearch.fromHour}:00-${jsearch.toHour}:00`);
}

module.exports = { startJSearch, collectJobs, postText };
