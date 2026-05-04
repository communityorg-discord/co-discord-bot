# Discord Server Audit — 2026-05-04

Read-only audit of all 9 CO guilds the bot is in. **Status update 07:30 UTC: ALL 8 findings closed (#6 documented as intentional, see section 6).** Loop continued past the audit into ~20 follow-on features — see git log on bot + portal repos.

## Already fixed in code

- ✅ `'CO Staff'` (no pipe) typo — bot's verify auto-flow tried this; every guild has `'CO | Staff'` (with pipe). Fixed in 928a535.
- ✅ Empty env vars (`STAFF_HQ_ID`, `NETWORK_SERVER_IDS`, `SUSPENDED_ROLE_ID`, `UNDER_INVESTIGATION_ROLE_ID`) — added runtime fallbacks (96b51a3) and name-based role lookup (57a77c1).
- ✅ Bulk role-add was all-or-nothing — switched to one-at-a-time so one denied role doesn't block the rest (f515b4d).

## Discord-state findings — 8/8 done

✅ **#1 (DONE)** — Bot Developer role created in all 9 guilds.
✅ **#2 (DONE)** — Under Investigation role created on Staff HQ.
✅ **#3 (DONE)** — IC guild role drift reconciled: renamed `IC | International Court` → `International Court`; created `Registrar of the International Court` and `Vice-President of the International Court`.
✅ **#4 (DONE)** — Founder role created on the 4 guilds missing it (Communications-small, System Log Hub, Private Server, Appeals Hub).
✅ **#5 (DONE)** — CO | Official Account role created on Dev Server.
✅ **#6 (DONE — INTENTIONAL)** — The 8-member `CO | Communications` is the private bot-ops/mod-tools server (channels: mass-unban, ban-unban, global-message, delete-message). Different purpose, different audience from the 45-member public guild. See section 6 below.
✅ **#7 (DONE)** — AutoMod enabled on Internal Hub (`automod_config.enabled = 1` for `1357119461957570570`).
✅ **#8 (DONE)** — Stale guild ID `1272007308704088074` removed from `verify.js` `EXCLUDED_WELCOME_INVITE_GUILDS`.

Net Discord state change: **17 roles created, 1 role renamed, 1 automod row updated**. All operations idempotent (skip-if-exists).

## Original finding details (kept for reference)

### 1. "Bot Developer" role missing everywhere

`POSITIONS["Bot Developer"]` references a `Bot Developer` role, but no CO guild has it. Any staff member with position `Bot Developer` gets no role applied on join.

**Options:** create the role in each relevant guild, OR remove the entry from `POSITIONS` if no one currently holds that position.

### 2. "Under Investigation" role missing everywhere

`addInvestigationRole()` would silently no-op (after the 57a77c1 fix). The `/investigate` command works for case creation + audit logging, but no Discord-side role gets applied to mark the user as under investigation.

**Options:** create `Under Investigation` role on Staff HQ (or every guild), OR drop the role-apply step from the investigation flow if it's no longer wanted.

### 3. CO | International Court guild — role-name drift

The IC guild has differently-named roles than `POSITIONS` expects:

| `POSITIONS` expects | Actual role name in IC guild |
|---|---|
| `International Court` | `IC | International Court` |
| `Registrar of the International Court` | `Clerk of the International Court` |
| `Vice-President of the International Court` | (no equivalent) |

Result: members with positions like `Judge of the International Court`, `Registrar of the International Court`, `Vice-President of the International Court`, or `President of the International Court` won't get the canonical "International Court" role applied in the IC guild itself.

**Options:** rename POSITIONS entries to match the IC guild's actual names, OR rename the IC guild's roles to match POSITIONS, OR add aliases.

### 4. Founder role missing from 4 guilds

`Founder` exists in CO | Internal Hub, CO | Staff HQ, CO | International Court, CO | Development Server. Missing from Communications, System Log Hub, Private Server, Appeals Hub.

If a Founder joins one of those four guilds, the role-apply step skips silently.

**Options:** add Founder role to the four missing guilds (low risk — symbolic role), OR accept that not every server needs it.

### 5. CO | Official Account role missing from CO | Development Server

The bypass-account position has its role in 8/9 guilds, missing from Dev Server only.

**Options:** add the role to Dev Server, OR confirm the dev server is not part of the official-account flow.

### 6. Two guilds named "CO | Communications" — RESOLVED (intentional)

- ID `1358129722931937280` — 45 members, created 2025-04-05, 27 channels (welcome/rules/general/announcements/tickets) — the real public Communications guild
- ID `1485423935569920135` — 8 members, created 2026-03-22, channels are `#mass-unban`, `#ban-unban`, `#global-message`, `#delete-message` — a private ops/mod-tools server for superusers, sharing the name by accident

Not a duplicate. Different purpose, different audience. The 8-member one is effectively the "Mod Ops" server — leaving the name alone to avoid disrupting the 8 members already using it.

### 7. Stale guild ID in welcome-DM exclusion list

`src/commands/verify.js` `EXCLUDED_WELCOME_INVITE_GUILDS` includes `1272007308704088074` — the bot is not a member of that guild, so the entry is dead. Cosmetic only.

### 8. AutoMod is disabled on CO | Internal Hub

`automod_config.enabled = 0` for guild `1357119461957570570` (CO | Internal Hub, 29 members). All 8 other guilds have AutoMod enabled. Either intentional (an admin disabled it) or a config gap.

`raid_detection`, `verify_timeout`, and `permission_guard` are still enabled in the per-feature flags — but the master `enabled` flag gates everything, so AutoMod actually does nothing on this guild right now.

**Options:** flip `enabled = 1` if you want AutoMod active on Internal Hub.

## Bot's permission posture

The bot has `ManageChannels`, `ManageRoles`, `KickMembers`, `BanMembers`, and `ManageGuild` in **all 9 guilds**. Bot's role position is 60–78 across guilds — high enough to manage most non-leadership roles, but not at the top. This is fine for normal operation; flag if you want the bot's role moved up to manage Founder/leadership-tier roles.
