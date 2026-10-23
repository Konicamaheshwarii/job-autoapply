// Reads job posts from Telegram channels/groups you have joined (read-only, as your own Telegram account) and
// hands them to the same pipeline as WhatsApp posts. Login once with `npm run telegram-login`.
const fs = require('fs');
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { ROOT, telegram } = require('./config');

const SESSION_FILE = path.join(ROOT, 'data', 'telegram.session');
const loadSession = () => { try { return fs.readFileSync(SESSION_FILE, 'utf8').trim(); } catch { return ''; } };
const newClient = (session) => new TelegramClient(new StringSession(session), telegram.apiId, telegram.apiHash, { connectionRetries: 5 });

/** One-time interactive login: asks for phone, the code Telegram sends, and the 2-step password if set. */
async function login() {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const client = newClient('');
  await client.start({
    phoneNumber: () => ask('Telegram phone number (with country code, e.g. +91...): '),
    phoneCode: () => ask('Code Telegram sent you: '),
    password: () => ask('Two-step password (if you set one): '),
    onError: (e) => console.log('Login problem:', e.message),
  });
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, client.session.save());
  console.log('Telegram login saved. You can close this window.');
  rl.close();
  await client.disconnect();
}

const matches = (entity) => {
  const names = [entity.username, entity.title].filter(Boolean).map((s) => String(s).trim().toLowerCase());
  return telegram.channels.some((c) => names.includes(c));
};

async function toPost(client, msg, source) {
  const text = msg.message || '';
  const post = { text, source };
  if (msg.photo && text.length < 400 && !/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) {
    try {
      const buf = await client.downloadMedia(msg, {});
      if (buf && buf.length) post.image = { mimetype: 'image/jpeg', data: Buffer.from(buf).toString('base64') };
    } catch {}
  }
  return post.text.trim().length >= 40 || post.image ? post : null;
}

/** Runs forever: reads the last 24 h of each watched channel on start, then every new post as it arrives. */
async function startTelegram({ onPost, log }) {
  const session = loadSession();
  if (!session) return log('Telegram: not logged in. Run: npm run telegram-login');
  const client = newClient(session);
  await client.connect();
  const dialogs = await client.getDialogs({ limit: 300 });
  const watched = dialogs.filter((d) => d.entity && matches(d.entity));
  log(`Telegram: watching ${watched.map((d) => d.title).join(', ') || 'nothing (check TELEGRAM_CHANNELS names)'}`);

  const since = Date.now() / 1000 - 24 * 3600;
  for (const d of watched) {
    const msgs = await client.getMessages(d.entity, { limit: 100 });
    for (const m of msgs.filter((x) => x.date >= since).reverse()) {
      const post = await toPost(client, m, `Telegram "${d.title}"`);
      if (post) await onPost(post);
    }
  }

  client.addEventHandler(async (event) => {
    try {
      const chat = await event.message.getChat();
      if (!chat || !matches(chat)) return;
      const post = await toPost(client, event.message, `Telegram "${chat.title || chat.username}"`);
      if (post) await onPost(post);
    } catch (e) {
      log(`Telegram: ${e.message}`);
    }
  }, new NewMessage({}));
}

module.exports = { startTelegram, login };
