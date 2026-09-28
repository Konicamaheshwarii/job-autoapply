// Renders a CV object to an ATS-friendly PDF: single column, real selectable text,
// standard section headings, no tables/images/icons, common font.
const puppeteer = require('puppeteer');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(cv) {
  const section = (title, body) => `<h2>${title}</h2>${body}`;
  const bullets = (list) => `<ul>${list.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cv.name)} - Resume</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.32; color: #111; margin: 0; }
  h1 { font-size: 19pt; margin: 0; text-align: center; letter-spacing: .5px; }
  .headline { text-align: center; font-size: 11.5pt; font-weight: bold; margin: 2px 0 3px; }
  .contact { text-align: center; font-size: 10pt; margin-bottom: 4px; }
  h2 { font-size: 11.5pt; text-transform: uppercase; border-bottom: 1px solid #333; margin: 10px 0 4px; padding-bottom: 1px; }
  h3 { font-size: 10.5pt; margin: 6px 0 1px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .muted { color: #333; }
  ul { margin: 2px 0 0 0; padding-left: 16px; }
  li { margin: 1px 0; }
  p { margin: 0; }
  .skill { margin: 1px 0; }
</style></head><body>
<h1>${esc(cv.name.toUpperCase())}</h1>
<div class="headline">${esc(cv.title)}</div>
<div class="contact">${esc(cv.email)} | ${esc(cv.phone)} | ${esc(cv.location)}<br>${esc(cv.linkedin)}</div>
${section('Summary', `<p>${esc(cv.summary)}</p>`)}
${section('Skills', Object.entries(cv.skills).map(([cat, list]) => `<p class="skill"><b>${esc(cat)}:</b> ${list.map(esc).join(', ')}</p>`).join(''))}
${section('Experience', cv.experience.map((e) => `
  <div class="row"><h3>${esc(e.role)}</h3><b>${esc(e.start)} - ${esc(e.end)}</b></div>
  <div class="row muted"><span>${esc(e.company)}</span><span>${esc(e.location)}</span></div>
  ${bullets(e.bullets)}`).join(''))}
${section('Projects', cv.projects.map((p) => `<h3>${esc(p.name)}</h3>${bullets(p.bullets)}`).join(''))}
${section('Education', cv.education.map((ed) => `
  <div class="row"><h3>${esc(ed.institution)}</h3><b>${esc(ed.year)}</b></div><p>${esc(ed.degree)}</p>`).join(''))}
</body></html>`;
}

let browserPromise;
function browser() {
  browserPromise ??= puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  return browserPromise;
}

async function renderPdf(cv, outPath) {
  const page = await (await browser()).newPage();
  try {
    await page.setContent(html(cv), { waitUntil: 'load' });
    await page.pdf({ path: outPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
  return outPath;
}

async function closePdf() {
  if (browserPromise) await (await browserPromise).close();
  browserPromise = undefined;
}

module.exports = { renderPdf, closePdf, html };
