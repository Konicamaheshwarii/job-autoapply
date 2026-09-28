// Test the pipeline on a job post without WhatsApp:
//   npm run try -- path\to\job.txt
//   npm run try -- "We are hiring Angular developer 3-5 yrs, send CV to hr@x.com"
// WhatsApp applications are only printed; emails follow DRY_RUN in .env.
const fs = require('fs');
const { processPost } = require('./pipeline');
const { closePdf } = require('./pdf');

(async () => {
  const arg = process.argv.slice(2).join(' ');
  if (!arg) {
    console.log('Usage: npm run try -- <job.txt | "job post text">');
    process.exit(1);
  }
  const text = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  const results = await processPost(
    { text },
    {
      notify: async (m) => console.log(`\n[notification]\n${m}\n`),
      sendWhatsApp: async (n, m, pdf) => console.log(`\n[would WhatsApp ${n}]\n${m}\nattachment: ${pdf}\n`),
    }
  );
  if (!results.length) console.log('Not a job post.');
  await closePdf();
})().catch(async (e) => {
  console.error(e);
  await closePdf();
  process.exit(1);
});
