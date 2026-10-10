// Read-only LinkedIn reader: opens LinkedIn post search in its own logged-in Chrome profile, reads the hiring
// posts (text and poster images) like a person would, and hands them to the same pipeline as WhatsApp posts.
// It never clicks Easy Apply, never sends messages or connection requests, and stops itself at any
// captcha / "unusual activity" page.
const path = require('path');
const puppeteer = require('puppeteer');
const { ROOT, linkedin } = require('./config');

const PROFILE_DIR = path.join(ROOT, 'data', 'linkedin-profile');
// Login and reading must look identical to LinkedIn (same real, visible Chrome; reading just keeps it off-screen),
// otherwise it ends the session. No fake user agent, no headless.
const LAUNCH = { userDataDir: PROFILE_DIR, ignoreDefaultArgs: ['--enable-automation'] };
const ARGS = ['--no-sandbox', '--disable-blink-features=AutomationControlled'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const BLOCKED = /\/checkpoint|\/authwall|\/uas\/|\/login|captcha|challenge/i;

const searchUrl = (q) => 'https://www.linkedin.com/search/results/content/?keywords=' + encodeURIComponent(q)
  + '&datePosted=%22past-24h%22&sortBy=%22date_posted%22&origin=FACETED_SEARCH';

// Runs inside the page: returns one entry per post with its text and the index of its poster image.
function readPosts() {
  const sel = 'div[role="listitem"], div[data-urn^="urn:li:activity"], div.feed-shared-update-v2, li.reusable-search__result-container';
  const all = [...document.querySelectorAll(sel)].filter((el) => el.innerText.length > 80);
  const posts = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
  return posts.map((el, i) => {
    el.querySelectorAll('button').forEach((b) => { if (/(…|\.\.\.)\s*more$|see more/i.test(b.innerText.trim())) b.click(); });
    const textEl = el.querySelector('.update-components-text, .feed-shared-text, .break-words') || el;
    let text = textEl.innerText.replace(/\n{3,}/g, '\n\n').trim();
    // Drop the author header ("Feed post / name / headline / 2m / Follow") so the job text comes first.
    const lines = text.split('\n');
    const at = lines.slice(0, 14).findIndex((l) => /^(Follow|Connect|Following)$/.test(l.trim()));
    if (at >= 0) text = lines.slice(at + 1).join('\n').trim();
    const img = [...el.querySelectorAll('img')].find((im) => im.naturalWidth >= 400 && im.naturalHeight >= 300
      && !/profile|avatar|logo|ghost/i.test(`${im.className} ${im.alt} ${im.src}`));
    if (img) img.setAttribute('data-bot-poster', String(i));
    el.setAttribute('data-bot-post', String(i));
    return { i, text: text.slice(0, 5000), hasImage: Boolean(img) };
  });
}

/**
 * Opens a visible Chrome so the user can log in to LinkedIn; the session is kept in PROFILE_DIR.
 * Closes by itself once the feed is reached. Returns true if the login worked within waitMin minutes.
 */
async function login({ waitMin = 15 } = {}) {
  const browser = await puppeteer.launch({ ...LAUNCH, headless: false, defaultViewport: null, args: ARGS });
  let ok = false;
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    for (const end = Date.now() + waitMin * 60000; Date.now() < end && browser.connected;) {
      await sleep(3000);
      const url = page.url();
      if (/linkedin\.com\/(feed|mynetwork|jobs|in\/|notifications)/.test(url)) { ok = true; await sleep(4000); break; }
    }
  } catch {}
  await browser.close().catch(() => {});
  return ok;
}

/** One pass over the configured searches. Returns the posts found: [{text, image?}] */
async function collectPosts({ log }) {
  const browser = await puppeteer.launch({ ...LAUNCH, headless: false, args: [...ARGS, '--window-position=-2400,0', '--window-size=1280,1000'] });
  const found = [];
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    let images = 0;
    for (const q of linkedin.searches) {
      await page.goto(searchUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(rand(4000, 7000));
      if (BLOCKED.test(page.url())) {
        const e = new Error(`LinkedIn asked for a login or check (${new URL(page.url()).pathname})`);
        e.blocked = true;
        throw e;
      }
      for (let s = 0; s < 6; s++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
        await sleep(rand(2500, 5000));
      }
      const posts = await page.evaluate(readPosts);
      for (const p of posts.slice(0, linkedin.maxPostsPerSearch)) {
        const post = { text: p.text, source: `linkedin "${q}"` };
        // Poster images cost AI vision calls, so only read them when the text has no email to send the CV to.
        if (p.hasImage && !/[\w.+-]+@[\w-]+\.[\w.]+/.test(p.text) && images < linkedin.maxImagesPerRun) {
          try {
            const el = await page.$(`[data-bot-poster="${p.i}"]`);
            if (el) {
              post.image = { mimetype: 'image/png', data: await el.screenshot({ encoding: 'base64' }) };
              images++;
            }
          } catch {}
        }
        if (post.text.length >= 40 || post.image) found.push(post);
      }
      log(`LinkedIn "${q}": ${posts.length} post(s) read`);
      await sleep(rand(8000, 15000));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return found;
}

/**
 * Runs forever: every ~linkedin.intervalMin minutes, during working hours only, reads new posts and calls
 * onPost(post) for each. After a login/captcha page it stays off for 6 hours and calls onBlocked(message).
 */
function startLinkedIn({ onPost, onBlocked, onLoginNeeded, log }) {
  let pausedUntil = 0;
  async function cycle() {
    let next = linkedin.intervalMin * 60000 * rand(0.8, 1.25);
    const hour = new Date().getHours();
    if (Date.now() >= pausedUntil && hour >= linkedin.fromHour && hour < linkedin.toHour) {
      try {
        const posts = await collectPosts({ log });
        for (const p of posts) await onPost(p);
      } catch (e) {
        log(`LinkedIn: ${e.message}`);
        if (e.blocked) {
          // Not logged in (first start, or LinkedIn logged us out): open a login window and wait for the user.
          await onLoginNeeded().catch(() => {});
          log('LinkedIn: opened a login window, waiting up to 15 min for you to log in...');
          if (await login()) {
            log('LinkedIn: login done.');
            next = 60 * 1000;
          } else {
            pausedUntil = Date.now() + 6 * 3600 * 1000;
            await onBlocked(e.message).catch(() => {});
          }
        }
      }
    }
    setTimeout(cycle, next);
  }
  setTimeout(cycle, 60 * 1000);
  log(`LinkedIn reader on: ${linkedin.searches.length} search(es) every ~${linkedin.intervalMin} min, ${linkedin.fromHour}:00-${linkedin.toHour}:00`);
}

module.exports = { startLinkedIn, login, collectPosts };
