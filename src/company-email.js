// Finds a company's recruitment email (careers@, hr@, jobs@, talent@...) on its own public website, so a job
// that only has an "apply on the portal" link can still be applied to by email. Only addresses on the company's
// own domain with a hiring-related name are used; info@ / sales@ / support@ are never used.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const CACHE_FILE = path.join(ROOT, 'data', 'company-emails.json');
const PAGES = ['', '/careers', '/career', '/jobs', '/join-us', '/work-with-us', '/contact', '/contact-us'];
const HIRING = /^(careers?|jobs?|hr|hrd|recruit\w*|talent\w*|hiring|people|joinus|join|resume|cv|apply|work)\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cache;
const loadCache = () => {
  if (!cache) { try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; } }
  return cache;
};
const saveCache = () => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {} };

/** "https://www.acme.com/about" -> { origin: "https://www.acme.com", domain: "acme.com" } */
function siteOf(url) {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return { origin: u.origin, domain: u.hostname.replace(/^www\./i, '').toLowerCase() };
  } catch { return null; }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!res.ok) return '';
  return (await res.text()).slice(0, 800000);
}

/**
 * @returns {Promise<string|null>} a hiring email on the company's own domain, or null.
 * Results (also "not found") are cached per domain so each company site is visited once.
 */
async function findCompanyEmail(website, log = () => {}) {
  const site = siteOf(website || '');
  if (!site) return null;
  const c = loadCache();
  if (site.domain in c) return c[site.domain];

  let found = null;
  for (const p of PAGES) {
    let html = '';
    try { html = await fetchText(site.origin + p); } catch { continue; }
    const emails = [...new Set((html.replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, '@').match(EMAIL) || []).map((e) => e.toLowerCase()))];
    found = emails.find((e) => {
      const [local, dom] = e.split('@');
      const sameDomain = dom === site.domain || dom.endsWith(`.${site.domain}`) || site.domain.endsWith(`.${dom}`);
      return sameDomain && HIRING.test(local) && !/\.(png|jpe?g|gif|svg|webp)$/i.test(e);
    }) || null;
    if (found) break;
  }
  c[site.domain] = found;
  saveCache();
  log(`  company site ${site.domain}: ${found ? `found ${found}` : 'no hiring email'}`);
  return found;
}

module.exports = { findCompanyEmail, siteOf };
