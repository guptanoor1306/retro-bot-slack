# Video Production Retro Bot

Slack bot for post-release retrospectives. Producers schedule retros with `/retro`; on release day at **10 AM IST** the bot opens a thread in `#video-retros`, DMs each role, and collects structured feedback stored in **Google Sheets** (no paid database).

## Architecture

```
/retro (Slack modal) → Google Sheets (Retros tab)
                              ↓
Daily cron (10 AM IST) → #video-retros thread + DMs
                              ↓
Fill Retro (modal) → Google Sheets (Responses tab) → thread updates
```

| File | Purpose |
|------|---------|
| `index.js` | Entry point, env validation, startup |
| `src/slackApp.js` | Slash command, modals, button actions |
| `src/sheets.js` | Google Sheets read/write |
| `src/scheduler.js` | Daily 10 AM IST trigger |
| `src/views.js` | Slack modal definitions |
| `src/messages.js` | Slack message formatting |
| `src/utils.js` | IDs, dates, logging, role helpers |

## Prerequisites

- Node.js 18+
- A Slack workspace where you can create apps
- A Google Cloud project with Sheets API enabled
- A Google Spreadsheet shared with the service account

## 1. Google Sheets Setup

1. Create a spreadsheet with two tabs: **Retros** and **Responses**.
2. Headers are created automatically on first run, or add them manually:

**Retros**

| retro_id | video_name | ip_name | release_date | writer_slack_id | editor_slack_id | designer_slack_id | sound_slack_id | created_by | status | channel_id | thread_ts | created_at | opened_at | completed_at |

**Responses**

| response_id | retro_id | role | user_slack_id | good | bad | action_items | submitted_at |

3. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### Service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Enable **Google Sheets API**.
2. Create a service account → Keys → Add key → JSON.
3. Share the spreadsheet with the service account email (Editor access).
4. Paste the entire JSON into `GOOGLE_SERVICE_ACCOUNT_JSON` (single line in `.env`).

## 2. Slack App Setup

Create an app at [api.slack.com/apps](https://api.slack.com/apps).

### OAuth & Permissions (Bot Token Scopes)

- `chat:write`
- `chat:write.public`
- `commands`
- `im:write`
- `users:read`

Install to workspace and copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`.

### Socket Mode (recommended for local dev — do this first)

1. Go to **Settings → Socket Mode** → Enable.
2. Generate an **App-Level Token** with `connections:write` → `SLACK_APP_TOKEN`.
3. Set `USE_SOCKET_MODE=true` in `.env`.

With Socket Mode on, Slack delivers slash commands over the WebSocket — it does **not** call the Request URL. Slack still forces you to fill the field; use any valid HTTPS placeholder:

```
https://example.com
```

### Slash Command

| Field | Value |
|-------|-------|
| Command | `/retro` |
| Request URL | `https://example.com` (Socket Mode) **or** `https://your-host/slack/events` (HTTP mode) |
| Short Description | Schedule a video retro |

### Interactivity

Enable **Interactivity**.

| Mode | Request URL |
|------|-------------|
| Socket Mode | Skip — not required when Socket Mode is enabled |
| HTTP mode | `https://your-host/slack/events` |

### Event Subscriptions (HTTP mode only)

Skip if using Socket Mode. For production HTTP deploy, enable events with Request URL: `https://your-host/slack/events`.

### Basic Information

Copy **Signing Secret** → `SLACK_SIGNING_SECRET`.

### Channel

Create `#video-retros`, invite the bot, copy channel ID (right-click → View channel details) → `RETRO_CHANNEL_ID`.

## 3. Environment

```bash
cp .env.example .env   # create at project root (not src/)
# Edit .env with your values
npm install
npm start
```

## 4. Usage

### Schedule a retro (Producer)

1. Run `/retro` in any channel.
2. Fill in video name, IP, **type** (Long-form / Shorts-Reels / Podcast), release date, and assign all four roles.
3. Status is saved as `scheduled`. The producer gets a confirmation DM with an **Open Retro Now** button.

### Open retro early (Producer)

Click **Open Retro Now** in the scheduling confirmation DM. Only the creator can do this. The retro opens immediately and **will not** auto-open the next morning.

### Automatic open (day after release, 10 AM IST)

Videos typically release by ~6 PM. Retros auto-open at **10 AM IST the next day** after `release_date`.

Example: release on Monday → retro opens Tuesday 10 AM IST.

For each matching retro where `status` is `scheduled`:

1. Posts parent message in `#video-retros`.
2. DMs each assignee with **Fill Retro**.
3. Sets `status` to `open`, `open_trigger` to `scheduled`.

### Fill retro (Assignees)

1. Click **Fill Retro** in the DM.
2. Answer: What was good? / What was bad? / Action Items.
3. Response is saved, posted in the thread, and parent message updates to **Submitted**.
4. When all 4 roles submit → `status` = `complete`, summary posted with all action items.

### Test today's retro (manual)

Use this to verify the full flow without waiting for 10 AM IST.

**Terminal 1 — keep the bot running** (handles `/retro`, Fill Retro modals, and buttons):

```bash
npm start
```

**Step 1 — Schedule a retro**

1. In Slack, run `/retro`.
2. Set **Release Date** to **yesterday** (to test auto-open logic) or use **Open Retro Now** for immediate test.
3. Assign all four roles.
4. Submit → confirmation DM with **Open Retro Now** button.

**Option A — open immediately:** click **Open Retro Now** in the DM.

**Option B — test scheduler:** set release date to yesterday, then:

```bash
npm run open-retros
```

Posts the thread in `#video-retros`, DMs assignees, sets status to `open`.

**Step 2 — Fill retros**

1. Open each **Fill Retro** DM from the bot.
2. Click **Fill Retro** → complete the modal → submit.
3. Repeat until all four roles are submitted.

**Step 3 — Verify**

| Check | Expected |
|-------|----------|
| `#video-retros` | Parent thread: Pending → Submitted per role |
| Thread replies | Each role's good / bad / action items |
| After 4 submissions | "Retro complete" + action items summary |
| **Retros** sheet | `status` = `complete`, timestamps filled |
| **Responses** sheet | 4 rows for that `retro_id` |

Optional — simulate auto-open for a date: `npm run open-retros -- 2026-06-30`

## 5. Insights dashboard (week-on-week learning)

After retros are complete, use the insights site to compare an IP's latest retro vs the previous one (same IP + type), map Premier feedback, run AI analysis, and publish to the retro's Slack thread.

```bash
npm run insights
# Open http://localhost:4000
```

### Workflow

1. Select a completed retro (e.g. Zerodha Online · Long-form).
2. Enter Premier video IDs to map viewer feedback.
3. Click **Run analysis** — compares previous retro action items vs latest "what was bad", plus Premier data.
4. Review/edit the analysis, click **Publish to Slack thread**.

### Env vars for insights

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | AI learning verdict (optional — falls back to structured comparison) |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `PREMIER_API_URL` | Base URL for Premier feedback API |
| `PREMIER_API_KEY` | Premier API auth |
| `INSIGHTS_PORT` | Dashboard port (default 4000) |

Premier API expected shape: `GET /feedback?ip=...&video_ids=...` → `{ videos: [{ id, title, feedback }] }`

Mappings are saved to the **PremierMappings** sheet tab.

## Status values

| Status | Meaning |
|--------|---------|
| `scheduled` | Created, waiting for release date |
| `open` | Thread live, collecting responses |
| `complete` | All 4 roles submitted |

## Deployment (cost-efficient)

The bot needs a **single always-on process** for the daily cron (no paid scheduler required).

| Option | Cost | Notes |
|--------|------|-------|
| Railway / Render free tier | $0–5/mo | Simple Node deploy |
| Fly.io | ~$0 | Small VM, set `USE_SOCKET_MODE=false` + public URL |
| Local machine + Socket Mode | $0 | Fine for testing |

Use HTTP mode in production (`USE_SOCKET_MODE=false`) with a public HTTPS URL for Slack events.

## Future: Retro Insights (week-on-week)

Implemented in `npm run insights` — see section 5 above. Planned enhancements:

- Auto-publish insights when retro completes
- Richer Premier API integration
- Trend charts across multiple releases per IP

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot doesn't respond to `/retro` | Reinstall app, check scopes, verify Socket Mode token |
| Sheets permission denied | Share sheet with service account email |
| DMs not delivered | User must have DMed the bot once, or allow app home messages |
| Scheduler didn't run | Process must be running at 10 AM IST; check logs |

Logs use `[INFO]` and `[ERROR]` prefixes to stdout.

## License

MIT
