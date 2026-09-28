// Provider-agnostic "ask the model, get JSON back" helper.
// Tries a chain of provider:model entries (e.g. Groq first, Gemini as backup) so free-tier
// limits or "busy" errors on one model don't stop the bot.
const { ai } = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(text) {
  const cleaned = String(text).trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // reasoning models
    .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error(`AI did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}

async function post(url, headers, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // internet hiccup
      if (attempt < 3) { await sleep(10000 * attempt); continue; }
      const err = new Error(`AI network error: ${e.cause?.code || e.message}`);
      err.tryNext = true;
      throw err;
    }
    if (res.ok) return res.json();
    const text = await res.text();
    const dailyQuota = res.status === 429 && /PerDay|per day|\bTPD\b|\bRPD\b/i.test(text);
    // Short per-minute limit: wait as long as the server asks (max 60s) and retry once.
    if (res.status === 429 && !dailyQuota && attempt < 2) {
      const after = Number(res.headers.get('retry-after')) || 20;
      await sleep(Math.min(after, 60) * 1000);
      continue;
    }
    const err = new Error(`AI request failed (${res.status}): ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    err.dailyQuota = dailyQuota;
    err.tryNext = res.status === 429 || res.status === 404 || res.status === 413 || res.status >= 500;
    throw err;
  }
}

function openAiCompatible(baseUrl, apiKey) {
  return async ({ system, user, image, model }) => {
    const content = image
      ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${image.data}` } }]
      : user;
    const json = await post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { authorization: `Bearer ${apiKey}` }, {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    });
    return json.choices[0].message.content;
  };
}

async function callGemini({ system, user, image, model, apiKey }) {
  const parts = [{ text: user }];
  if (image) parts.push({ inline_data: { mime_type: image.mimetype, data: image.data } });
  const json = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': apiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }
  );
  return json.candidates[0].content.parts.map((p) => p.text || '').join('');
}

async function callAnthropic({ system, user, image, model, apiKey }) {
  const content = [{ type: 'text', text: user }];
  if (image) content.unshift({ type: 'image', source: { type: 'base64', media_type: image.mimetype, data: image.data } });
  const json = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: 4096,
      temperature: 0.2,
      system: `${system}\nRespond with a single JSON object only, no prose.`,
      messages: [{ role: 'user', content }],
    }
  );
  return json.content.map((c) => c.text || '').join('');
}

function caller(provider) {
  const key = ai.keys[provider];
  if (!key) return null;
  if (provider === 'groq') return openAiCompatible('https://api.groq.com/openai/v1', key);
  if (provider === 'openai') return openAiCompatible(ai.baseUrl, key);
  if (provider === 'gemini') return (o) => callGemini({ ...o, apiKey: key });
  if (provider === 'anthropic') return (o) => callAnthropic({ ...o, apiKey: key });
  return null;
}

// "provider:model" -> day its free daily quota ran out
const exhausted = new Map();
const today = () => new Date().toISOString().slice(0, 10);

/**
 * @param {{system:string, user:string, image?:{mimetype:string,data:string}, patient?:boolean}} opts
 * patient=true waits up to an hour when every model is busy; false fails fast so the caller can fall back to rules.
 */
async function askJson(opts) {
  const chain = (opts.image ? ai.visionChain : ai.chain).filter((e) => caller(e.provider));
  if (!chain.length) throw new Error('No AI key set in .env (GROQ_API_KEY / GEMINI_API_KEY)');
  const rounds = opts.patient ? 6 : 1;

  for (let round = 1; round <= rounds; round++) {
    let tried = 0;
    for (const e of chain) {
      const id = `${e.provider}:${e.model}`;
      if (exhausted.get(id) === today()) continue;
      tried++;
      try {
        return parseJson(await caller(e.provider)({ system: opts.system, user: opts.user, image: opts.image, model: e.model }));
      } catch (err) {
        if (err.dailyQuota) exhausted.set(id, today());
        if (!err.tryNext) throw err;
        console.log(`AI ${id}: ${err.dailyQuota ? 'daily free quota used up' : `busy (${err.message.slice(0, 50)})`}, trying next...`);
      }
    }
    if (!tried) break; // everything is out of daily quota
    if (round < rounds) {
      console.log(`All AI models busy. Waiting 10 min, then trying again (${round}/${rounds})...`);
      await sleep(10 * 60000);
    }
  }
  const err = new Error('AI unavailable right now (free quota used up or servers busy).');
  err.quotaExhausted = true;
  throw err;
}

module.exports = { askJson, parseJson };
