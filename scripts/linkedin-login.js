// One-time: opens a visible Chrome so you can log in to LinkedIn yourself. The session is saved in
// data/linkedin-profile and reused by the bot. Run: npm run linkedin-login
require('../src/linkedin').login().then(() => process.exit(0));
