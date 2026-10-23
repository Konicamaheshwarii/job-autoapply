// One-time: logs in to Telegram as you (phone number + the code Telegram sends). Run: npm run telegram-login
// Needs TELEGRAM_API_ID and TELEGRAM_API_HASH in .env (create them at https://my.telegram.org -> API development tools).
const { telegram } = require('../src/config');
if (!telegram.apiId || !telegram.apiHash) {
  console.log('Add TELEGRAM_API_ID and TELEGRAM_API_HASH to .env first (get them at https://my.telegram.org -> API development tools).');
  process.exit(1);
}
require('../src/telegram').login().then(() => process.exit(0)).catch((e) => { console.log('Login failed:', e.message); process.exit(1); });
