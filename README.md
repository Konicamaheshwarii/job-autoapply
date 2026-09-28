# Job Auto-Apply

A WhatsApp bot that watches job-opening groups and applies for you.

For every post in the groups you choose, it:

1. **Reads the post.** Text posts are parsed with rules, with no AI and no tokens. Image posters are read by an AI vision model.
2. **Scores the job against your CV.** 70% skill-keyword coverage (ATS style) and 30% role fit. Jobs in other stacks (Java, .NET, PHP...), jobs needing too much experience, and jobs you already applied to are skipped.
3. **Tailors your CV** for jobs above `MIN_SCORE`. It reorders and rewords only what is already in your CV and never adds skills, employers or numbers. The AI is used only when an application will actually be sent; if the AI is unavailable, a rule-based version is used.
4. **Renders an ATS-friendly PDF.** Single column, real text, standard headings.
5. **Applies.** It emails the HR address through Gmail, or sends the CV to the recruiter's number on WhatsApp.
6. **Reports** each action to your WhatsApp "Message yourself" chat and logs it to `data/applications.csv`.

## Setup

Requires Node.js 20+ on Windows, macOS or Linux.

```bash
npm install
cp .env.example .env                               # then fill it in
cp cv/master-cv.example.json cv/master-cv.json     # then put your real CV in it
```

`.env` settings:

| Key | What |
|---|---|
| `GROQ_API_KEY` | Free key from https://console.groq.com/keys (primary AI) |
| `GEMINI_API_KEY` | Free key from https://aistudio.google.com/apikey (backup AI) |
| `WHATSAPP_GROUPS` | Exact group name(s), comma-separated |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail address + [App Password](https://myaccount.google.com/apppasswords) |
| `DRY_RUN` | `true` = do everything except send. Start with this. |
| `MIN_SCORE`, `MAX_APPLICATIONS_PER_DAY` | Match threshold (default 70) and daily cap (default 12) |

## Run

```bash
npm run try -- sample-job.txt   # test one post, no WhatsApp needed
npm start                       # scan the QR once (WhatsApp > Linked devices)
```

On Windows, `scripts/run-bot.cmd` starts the bot and restarts it if WhatsApp Web breaks. To run it at login, put a shortcut to it in `shell:startup`.

## Notes

- `patches/` holds community fixes for whatsapp-web.js 1.34.7, which broke after the July 2026 WhatsApp Web update (wwebjs PRs #201910, #201871). They are applied automatically after `npm install`.
- WhatsApp does not allow bots on personal accounts. Use at your own risk; the daily cap and random send delays keep activity low.
- `cv/master-cv.json`, `.env`, `data/` and `out/` are git-ignored because they contain personal data.
