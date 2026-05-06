# CO Discord Bot

Discord.js v14 bot for the CO Staff network. Lives alongside the staff portal (`onboarding-portal`) on the same host. PM2-managed.

## Project basics
- Entry point: `src/index.js`
- HTTP webhook server: **port 3017** (hardcoded at `src/index.js:5720`)
- Discord gateway: long-lived WebSocket via `discord.js`
- Local DB: none of its own — opens the portal's SQLite read-only via `PORTAL_DB_PATH` at import time (`src/db.js:5`)
- Bot-specific config DB: `bot-data.db` (command_permissions, log channel routing, etc.) — created lazily by `src/utils/botDb.js`
- 91 slash commands in `src/commands/` (see `src/index.js` imports for the full list)

## Atlas integration (`POST /atlas-webhook`, added 2026-05-06)

The bot exposes one webhook for portal-side Atlas to send Discord
side-effects. **Atlas must never reach the Discord API directly** —
every DM, channel post, and embed goes through here so it's logged
to `atlas_bot_actions` for audit.

- **Endpoint:** `POST /atlas-webhook` on port 3017
- **Auth:** standard `x-bot-secret` header (same `BOT_WEBHOOK_SECRET`
  the portal uses for every other inbound webhook). Validated via
  `verifyBotSecret(req, res)`.
- **Body:** `{ action, ...args }` where `action` is one of:
  - `"dm"` — args: `user_discord_id`, `message`. Sent as an embed
    with the CO branding colour and "Community Organisation · Atlas"
    footer; truncates message at 4000 chars.
  - `"channel_message"` — args: `channel_id`, `content`. Plain text;
    truncates at 2000 chars.
  - `"embed"` — args: `channel_id`, `embed: { title?, description?, color?, fields?, footer? }`.
    `fields` capped at 25; each field truncated to Discord's per-field
    limits.
- **Response:** `{ ok: true, message_id }` on success; standard 4xx/5xx
  with `{error}` otherwise.

Audit table: `atlas_bot_actions` in `bot-data.db` (created in
`src/utils/botDb.js`). Columns: `created_at, action, target_id,
payload_json, result_status, error, message_id`. Helper:
`logAtlasBotAction({...})` — exported from `botDb.js` and called
from every code path in the `/atlas-webhook` handler (success, 4xx,
5xx). Indexed on `(created_at)` and `(action, created_at)`.

The portal-side counterpart (full request body, on-behalf-of, etc.)
lives in `atlas_actions` in the portal DB; cross-reference by
timestamp + target_id.

### Rules for new Atlas Discord actions
- Add a new `case` to the switch in the `/atlas-webhook` handler. Don't open a new endpoint — the auth + audit story is set up here.
- Always call `logAtlasBotAction({...})` in BOTH success and failure paths so the audit trail is complete.
- The bot must remain `BOT_WEBHOOK_SECRET`-only for inbound Atlas; do not introduce a separate Atlas key on the bot side. The portal carries the Atlas key; the bot trusts the portal.

## Cross-Service Contract (with onboarding-portal)
- Portal runs on port 3016. Bot reaches it via `PORTAL_HTTP` (default `http://localhost:3016`).
- All HTTP calls in BOTH directions carry `x-bot-secret: ${BOT_WEBHOOK_SECRET}` — same secret, both `.env` files. Mismatched secret = 401 from either side.
- The bot's webhook server validates incoming portal calls via `verifyBotSecret(req, res)` defined in `src/index.js`.
- Portal endpoints the bot calls: `/api/staff/by-discord/:id`, `/api/activity/sync`, `/api/activity/sync/bulk`, `/api/activity/voice-log`, `/api/cases/{id}/bot/ack-callback`, `/api/assignments/*`, `/api/transcripts`, `/api/recordings/{id}/transcribe`, `/api/directives/{id}/acknowledge`, `/api/disciplinary/non-investigational`, `/api/admin-tools/generate-setup-link`, `/api/drive/backfill-staff-folders`, `/api/atlas/cap-by-discord`, `/api/health`.
- Bot endpoints the portal calls: `POST /webhook/leave-start`, `/webhook/leave-end`, `/webhook/offboarding-remove-roles`, `/webhook/notify`, `/webhook/dm-with-attachment` (multipart), `POST /api/send-dm`, `/api/send-channel`, `/api/role/{assign,position,unassign}`, `/bot/{suspend,unsuspend,disciplinary,assignment-confirm}`, `/api/shop-approval-dm`, `GET /api/bot/{commands,command-permissions,guild-roles,health}`.

## Direct DB access (read-only)
- Bot opens `PORTAL_DB_PATH` via `better-sqlite3` with `{ readonly: true }`. Do NOT change to read-write or to an API round-trip — read-only direct access is intentional for hot paths (leaderboards, /aps, /stats, /cases lookup).
- Tables queried directly: `users`, `activity_weekly_grades`, `staff_leave`, `cases`, `helpdesk_tickets`, `leave_requests`, plus the `command_permissions` table in the bot's own `bot-data.db`.
- Discord IDs are stored as **TEXT strings** in the portal DB, not integers. Always wrap with `String(discordId)` in queries.
- ⚠️ Two commands open the portal DB in **read-write** mode (legacy / test cleanup): `src/commands/eliminate.js` and `src/services/leaveRoles.js`. Don't replicate this pattern; treat it as deprecated.

## Activity Points sync — DON'T REGRESS
- Bot brag/welcome sync: send **deltas** (`points: delta`), NOT cumulative totals. Update `last_synced_count` (or clear `welcomeTracker`) AFTER successful POST.
- Bot voice sync: same — send delta in points. `voice_time_tracking.last_synced_seconds` is the cursor, advance after a successful POST.
- Portal `/api/activity/sync/bulk` is ADDITIVE per record. Sending cumulative totals silently inflates everyone's points until they hit the cap. Bit us hard pre-2026-04-26.

## Bot Permissions (live 2026-04-26)
- Every slash command in `src/commands/*.js` routes through `await canUseCommand(name, interaction)` from `src/utils/permissions.js`.
- Storage: `command_permissions` table in `bot-data.db` (per-user + per-role grants, optional `:subcommand` keys).
- Each command file has a top-of-file marker:
  `// COMMAND_PERMISSION_FALLBACK: <kind>` — parsed at startup, applied ONLY when the table has zero rows for that command. Kinds: `superuser_only`, `everyone`, `auth_level >= N`, `role:<name>`, `role_id:<id>`. Subcommand modifier: `<kind>;subcommand=<sub>`. Option modifier: `<kind>;option=<name>=<value>`.
- ban.js = global cross-guild ban (superuser_only). serverban.js = single-guild ban (auth ≥ 5). They used to collide on `data.name = 'ban'` — fixed 2026-04-26; don't re-merge.

## DO NOT ADD (explicit retirement list)
- haydend (Discord ID `1013486189891817563`) as a superuser — revoked 2026-05-05; do NOT re-add to `HARDCODED_SUPERUSER_IDS` (`src/config.js`), `MAINTAINERS` (`src/commands/bot.js`), `MAINTAINER_IDS` (`src/commands/feedback.js`), `SUPERUSER_INVITE_IDS` / `COMMAND_SUPERUSERS` / `assign.js SUPERUSER_IDS` in `src/index.js`, or anywhere else
- Supabase dependency
- election tables
- `/roster`, `/status`, `/performance`, `/leave-calendar`
- daily briefings
- inactivity detection
- BRAG Black auto-infraction
- inbox/compose-email rebuild (the existing /inbox + /compose are kept; do not "rebuild")
- `/announce`, `/poll` (existing /poll is kept; do not add a new variant)
- case stage DMs
- probation role sync

## Stack
- Node 22, ESM, `discord.js` v14
- HTTP: `express` + `multer` (for attachment uploads)
- DB: `better-sqlite3` (read-only against portal DB; read-write against `bot-data.db`)
- Voice: `@discordjs/voice` + `prism-media` + `opusscript` + `ffmpeg-static`; recordings land in `/home/vpcommunityorganisation/clawd/recordings`
- Mail: `imap` + `mailparser` (inbound polling), Brevo API (outbound) — NOT `nodemailer`
- M365: `@azure/identity` (only used for `/audit-log` polling, not OAuth)

## Required env to start
- `DISCORD_BOT_TOKEN` (Discord login)
- `BOT_WEBHOOK_SECRET` — **FATAL on startup if missing** (src/index.js:112-115)
- `PORTAL_DB_PATH` — read at `src/db.js:5` import time; if file missing, every command that uses portalDb crashes
- See `.env.template` for the full list

## Operational notes
- PM2 process name: `co-discord-bot` — reference by name, IDs drift across restarts
- Restart only the bot: `pm2 restart co-discord-bot --update-env`
- Logs: `pm2 logs co-discord-bot --lines 100` or `~/.pm2/logs/co-discord-bot-*.log`
- Bot health check: `curl -s http://localhost:3017/api/health` (no auth header needed)
- A bot restart re-registers slash commands at startup — Discord propagation can take a few minutes
