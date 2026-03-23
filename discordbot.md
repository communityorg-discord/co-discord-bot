# CO Discord Bot — Development Reference

## Paths
- **Bot path:** `/home/vpcommunityorganisation/clawd/services/co-discord-bot`
- **Portal path:** `/home/vpcommunityorganisation/clawd/services/onboarding-portal`
- **PM2 bot process:** ID 1, name `co-discord-bot`
- **GitHub:** `https://github.com/communityorg-discord/co-discord-bot` (push to `main`)

## Stack
- Node.js + discord.js v14, **ESM only** — `import`/`export` everywhere, **never `require()`**
- Entry point: `src/index.js`
- Commands directory: `src/commands/` — each file is one command
- Utilities: `src/utils/` — shared helpers
- DB: `src/db.js` — SQLite via better-sqlite3, use `await db.run/get/all` (sync calls, no async/await wrapper needed)
- Config: `src/config.js` — exports `BOT_TOKEN` and other constants from env
- Portal API base: `http://localhost:3016/api` — use header `x-bot-secret: process.env.BOT_WEBHOOK_SECRET`

## Standard Commands
`bot.js`, `brag.js`, `cases.js`, `dm.js`, `gban.js`, `gunban.js`, `infractions.js`, `investigate.js`, `leave.js`, `nid.js`, `purge.js`, `scribe.js`, `staff.js`, `strike.js`, `suspend.js`, `terminate.js`, `unsuspend.js`, `unverify.js`, `user.js`, `verify.js`

## Critical Rules
1. **ESM only** — never `require()`, never CommonJS patterns
2. **File writes** — use node inline scripts (`node --input-type=module << 'EOF'`) or the `write`/`edit` tools. **Never use `str_replace`** — it fails constantly on this codebase.
3. **After adding/modifying a slash command** — re-register with:
   ```bash
   cd /home/vpcommunityorganisation/clawd/services/co-discord-bot && node src/index.js --register 2>&1 | tail -5
   ```
4. **Never modify `.env`** — token and secrets are already set
5. **Match existing patterns** — always read the relevant existing command file before writing a new one
6. **Never ask clarifying questions mid-task** — make the most logical implementation and report what you did

## Command Structure Pattern
Every command file follows this pattern:

```js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, requiresSuperuserWarning } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('commandname')
  .setDescription('Description')
  .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true));

export async function execute(interaction) {
  // 1. Permission check via canRunCommand(user.id, level)
  // 2. Options via interaction.options.getUser/getString
  // 3. Superuser warning check via requiresSuperuserWarning(target.id)
  // 4. await interaction.deferReply() — always defer first
  // 5. DB operations
  // 6. Send DM embed to target (wrapped in try/catch)
  // 7. Perform action (ban/kick/etc.)
  // 8. Log via logAction()
  // 9. await interaction.editReply({ embeds: [embed] }) — always use embeds for public replies
}
```

## Permissions
- `canRunCommand(discordId, level)` — checks portal auth_level, superusers bypass
- `requiresSuperuserWarning(targetId)` — warns when moderating a superuser
- `isSuperuser(discordId)` — true if in SUPERUSER_IDS

## Reply Style
- **Always use public embeds** for command responses — never ephemeral
- Use `await interaction.deferReply()` first, then `await interaction.editReply({ embeds: [...] })`
- Keep embeds consistent with existing commands (color, fields, footer, timestamp)
- Error replies should also be embeds, not plain text

## Deploy Loop
```bash
pm2 restart 1 --update-env && git add -A && git commit -m "feat: description" && git push origin main && pm2 logs 1 --lines 10 --nostream | tail -10
```

After every change:
1. Paste last 10 PM2 log lines confirming bot is online with no errors
2. Confirm pushed to `main` with commit hash

## Adding a New Command
1. Read 2–3 existing commands to match the pattern
2. Create `src/commands/<name>.js` with `data` (SlashCommandBuilder) and `execute` (async function)
3. Add import in `src/index.js`:
   ```js
   import * as cmdname from './commands/cmdname.js';
   ```
4. Add to the `commands` array in `src/index.js`
5. Restart: `pm2 restart 1 --update-env`
6. Git add → commit → push
