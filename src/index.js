// WhatsApp bot: listens to the configured job groups and feeds every post into the pipeline.
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { ROOT, whatsapp, rules, gmail, ai } = require('./config');
const { processPost } = require('./pipeline');
const { markSeen, unmarkSeen, isSeen } = require('./store');
const { verifyMailer } = require('./mailer');
const { closePdf } = require('./pdf');

// Show output in the window and also keep it in data/bot.log.
{
  const util = require('util');
  const logFile = path.join(ROOT, 'data', 'bot.log');
  require('fs').mkdirSync(path.dirname(logFile), { recursive: true });
  for (const k of ['log', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      orig(...a);
      try { require('fs').appendFileSync(logFile, util.format(...a) + '\n'); } catch {}
    };
  }
}
const log = (...a) => console.log(new Date().toLocaleString(), ...a);

// Only one bot may use the WhatsApp session at a time.
const fs = require('fs');
const pidFile = path.join(ROOT, 'data', 'bot.pid');
try {
  const old = Number(fs.readFileSync(pidFile, 'utf8'));
  if (old && old !== process.pid) {
    process.kill(old, 0); // throws if that process is gone
    console.log(`Job bot is already running (pid ${old}). Stop it first: taskkill /PID ${old} /F`);
    process.exit(0);
  }
} catch {}
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
fs.writeFileSync(pidFile, String(process.pid));
process.on('exit', () => { try { if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.unlinkSync(pidFile); } catch {} });

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(ROOT, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

async function notify(text) {
  if (!whatsapp.notifySelf || !client.info) return;
  try {
    await withTimeout(client.sendMessage(client.info.wid._serialized, text), 30000, 'Self-notification');
  } catch (e) {
    log('notify failed:', e.message);
    restartIfBroken(e);
  }
}

async function sendWhatsApp(number, message, pdfPath, pdfName) {
  const id = await client.getNumberId(number);
  if (!id) throw new Error(`${number} is not on WhatsApp`);
  const media = MessageMedia.fromFilePath(pdfPath);
  media.filename = pdfName;
  await client.sendMessage(id._serialized, message);
  await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));
  await client.sendMessage(id._serialized, media, { sendMediaAsDocument: true });
}

// Process posts one at a time so send delays and daily limits stay accurate.
let queue = Promise.resolve();

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);

// group id -> group name, filled from the chat list or lazily per message
const groupNames = new Map();
const isWatched = (name) => whatsapp.groups.includes(String(name || '').trim().toLowerCase());

async function groupNameOf(msg) {
  const id = msg.from;
  if (!id || !id.endsWith('@g.us')) return null;
  if (!groupNames.has(id)) {
    const chat = await withTimeout(msg.getChat(), 30000, 'getChat');
    groupNames.set(id, chat.name || '');
  }
  return groupNames.get(id);
}

let received = 0;

async function handle(msg) {
  const name = await groupNameOf(msg);
  if (!isWatched(name)) return;
  received++;
  const chat = { name };

  const text = msg.body || '';
  // Media posts are remembered by message id, so the 20-min re-scan doesn't download them again.
  const mediaKey = msg.hasMedia ? `media:${msg.id?._serialized || msg.id?.id}` : null;
  if (mediaKey && isSeen(mediaKey)) return;

  let image;
  if (msg.hasMedia && msg.type === 'image') {
    try {
      const media = await withTimeout(msg.downloadMedia(), 60000, 'Image download');
      if (media) image = { mimetype: media.mimetype, data: media.data };
    } catch (e) {
      // WhatsApp Web sometimes can't fetch old/expired images ("t" errors). Use the caption if there is one.
      log(`Could not download image in "${name}" (${e.message || e})${text ? ', using its caption' : ', skipped'}`);
    }
  }
  if (mediaKey) markSeen(mediaKey);
  if (msg.hasMedia && !image && !text.trim()) return; // image we couldn't download and no caption: nothing to read

  // Skip "ok", "thanks", "interested"... but never a short post that mentions the role.
  const mentionsRole = whatsapp.roleKeywords.some((k) => text.toLowerCase().includes(k));
  if (!image && text.trim().length < 40 && !mentionsRole) return log(`Short message in "${name}" (no Angular/frontend words), ignored`);
  if (!image && !text.trim()) return;
  const seenKey = text + (image ? image.data.slice(0, 5000) : '');
  if (!markSeen(seenKey)) return log('duplicate post, skipped');

  log(`New post in "${chat.name}": ${text.slice(0, 80).replace(/\s+/g, ' ')}${image ? ' [image]' : ''}`);
  try {
    await processPost({ text, image }, { sendWhatsApp, notify, log });
  } catch (e) {
    unmarkSeen(seenKey); // checked again on next start
    throw e;
  }
}

// The WhatsApp Web page inside the bot died; a clean restart is the only fix.
function restartIfBroken(e) {
  if (/detached Frame|Target closed|Session closed|Execution context was destroyed|Protocol error/i.test(String(e && e.message))) {
    log('WhatsApp connection broke. Restarting the bot in 5s...');
    setTimeout(() => process.exit(2), 5000);
    return true;
  }
  return false;
}

client.on('qr', (qr) => {
  console.log('\nScan this QR with WhatsApp > Linked devices > Link a device:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => log('WhatsApp authenticated'));
client.on('auth_failure', (m) => log('Auth failure:', m));
client.on('disconnected', (r) => {
  log('Disconnected:', r, '- restarting...');
  setTimeout(() => process.exit(2), 5000);
});

// WhatsApp Web can fire "ready" several times; run startup once.
let started = false;

client.on('ready', async () => {
  if (started) return;
  started = true;
  log('WhatsApp ready - listening for new messages. Checking group list (can take a minute)...');
  let groups = [];
  try {
    groups = (await withTimeout(client.getChats(), 90000, 'Loading chat list')).filter((c) => c.isGroup);
    for (const g of groups) groupNames.set(g.id._serialized, g.name || '');
  } catch (e) {
    log(`${e.message || e}. Not a problem: the bot still listens and checks each new message's group.`);
  }
  const watched = groups.filter((g) => isWatched(g.name));
  if (!groups.length) {
    log(`Watching (by name): ${whatsapp.groups.join(', ')}`);
  } else if (!watched.length) {
    log('No group is being watched yet. Copy your job group name from this list into WHATSAPP_GROUPS in .env, then restart:\n  '
      + groups.map((g) => g.name).join('\n  '));
  } else {
    log('Watching: ' + watched.map((g) => g.name).join(', '));
  }
  if (gmail.user && !rules.dryRun) {
    try {
      await verifyMailer();
      log('Gmail login OK');
    } catch (e) {
      log('Gmail login FAILED, email applications will error:', e.message);
    }
  }
  log(`AI: ${ai.model} | min score ${rules.minScore} | max ${rules.maxPerDay}/day | ${rules.dryRun ? 'DRY RUN (nothing is sent)' : 'LIVE'}`);
  watchedChats = watched;
  if (whatsapp.backfillToday && watched.length) setTimeout(() => backfillToday(watched), 2000);
  await notify(`🤖 Job bot started (${rules.dryRun ? 'dry run' : 'LIVE'}). Watching: ${watched.map((g) => g.name).join(', ') || (groups.length ? 'nothing - check WHATSAPP_GROUPS' : whatsapp.groups.join(', '))}`);
});

let quotaWarnedOn = null;

function enqueue(msg) {
  queue = queue.then(() => handle(msg)).catch((e) => {
    log('Error handling message:', e.message);
    if (restartIfBroken(e)) return;
    if (e.quotaExhausted) {
      const day = new Date().toDateString();
      if (quotaWarnedOn === day) return;
      quotaWarnedOn = day;
    }
    notify(`⚠️ Job bot error: ${e.message}`);
  });
  return queue;
}

client.on('message', (msg) => enqueue(msg));

// Posts that arrived while the bot was off (or while WhatsApp silently stopped sending events).
let watchedChats = [];
let backfillRunning = false;

async function backfillToday(chats, { quiet = false } = {}) {
  if (backfillRunning) return;
  backfillRunning = true;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (whatsapp.backfillDays - 1));
  const period = whatsapp.backfillDays === 1 ? 'today' : `the last ${whatsapp.backfillDays} days`;
  try {
    for (const chat of chats) {
      let msgs;
      try {
        msgs = await withTimeout(chat.fetchMessages({ limit: whatsapp.backfillLimit }), 180000, 'Loading earlier messages');
      } catch (e) {
        log(`Could not load earlier messages from "${chat.name}": ${e.message}`);
        if (restartIfBroken(e)) return;
        continue;
      }
      const recent = msgs.filter((m) => m.timestamp * 1000 >= since.getTime() && !m.fromMe);
      const roleWord = (t) => whatsapp.roleKeywords.some((k) => t.toLowerCase().includes(k));
      const fresh = recent.filter((m) => (m.hasMedia
        ? !isSeen(`media:${m.id?._serialized || m.id?.id}`)
        : (m.body || '').trim().length >= 40 || roleWord(m.body || '')) && !isSeen(m.body || ''));
      if (quiet && !fresh.length) continue;
      log(`Checking ${fresh.length} new message(s) from ${period} in "${chat.name}" (${recent.length - fresh.length} already checked)...`);
      if (!quiet) await notify(`🔎 Checking ${fresh.length} message(s) posted ${period} in "${chat.name}"...`);
      for (const m of fresh) {
        await enqueue(m);
        await new Promise((r) => setTimeout(r, 3000)); // stay under free AI rate limits
      }
      log(`Finished messages from ${period} in "${chat.name}". Now waiting for new posts.`);
      if (!quiet) await notify(`✅ Done checking posts from ${period} in "${chat.name}". Waiting for new ones.`);
    }
  } finally {
    backfillRunning = false;
  }
}

setInterval(() => log(`alive - ${received} group message(s) received so far`), 15 * 60 * 1000);

// Safety net 1: re-scan the group every 20 min, in case WhatsApp stopped delivering live messages.
setInterval(() => {
  if (watchedChats.length) backfillToday(watchedChats, { quiet: true }).catch((e) => log('re-scan failed:', e.message));
}, 20 * 60 * 1000);

// Safety net 2: after the PC sleeps, the WhatsApp Web connection goes stale without any error. Restart.
let lastTick = Date.now();
setInterval(() => {
  const gap = Date.now() - lastTick;
  lastTick = Date.now();
  if (gap > 3 * 60 * 1000) {
    log(`PC was asleep for ${Math.round(gap / 60000)} min. Restarting to reconnect WhatsApp...`);
    setTimeout(() => process.exit(2), 2000);
  }
}, 60 * 1000);

// Safety net 3: WhatsApp says it's no longer connected -> restart.
setInterval(async () => {
  if (!started) return;
  try {
    const state = await withTimeout(client.getState(), 30000, 'Connection check');
    if (state !== 'CONNECTED') {
      log(`WhatsApp state is ${state}. Restarting...`);
      setTimeout(() => process.exit(2), 2000);
    }
  } catch (e) {
    log(`Connection check failed (${e.message}). Restarting...`);
    setTimeout(() => process.exit(2), 2000);
  }
}, 10 * 60 * 1000);

async function shutdown() {
  log('Shutting down...');
  await closePdf().catch(() => {});
  await client.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
// One bad WhatsApp Web call must not kill the bot.
process.on('unhandledRejection', (e) => log('Unhandled error:', (e && e.message) || e));
process.on('SIGTERM', shutdown);

client.initialize();
