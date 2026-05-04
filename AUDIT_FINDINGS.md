# Discord Server Audit — 2026-05-04

Read-only audit of all 9 CO guilds the bot is in. Findings flagged for human review before any Discord-state change.

## Already fixed in code

- ✅ `'CO Staff'` (no pipe) typo — bot's verify auto-flow tried this; every guild has `'CO | Staff'` (with pipe). Fixed in 928a535.
- ✅ Empty env vars (`STAFF_HQ_ID`, `NETWORK_SERVER_IDS`, `SUSPENDED_ROLE_ID`, `UNDER_INVESTIGATION_ROLE_ID`) — added runtime fallbacks (96b51a3) and name-based role lookup (57a77c1).
- ✅ Bulk role-add was all-or-nothing — switched to one-at-a-time so one denied role doesn't block the rest (f515b4d).

## Discord-state findings (need human sign-off)

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

### 6. Two guilds named "CO | Communications"

- ID `1358129722931937280` — 45 members
- ID `1485423935569920135` — 8 members

Either intentional (community vs internal) or one is a stale duplicate. Worth confirming.

### 7. Stale guild ID in welcome-DM exclusion list

`src/commands/verify.js` `EXCLUDED_WELCOME_INVITE_GUILDS` includes `1272007308704088074` — the bot is not a member of that guild, so the entry is dead. Cosmetic only.

## Bot's permission posture

The bot has `ManageChannels`, `ManageRoles`, `KickMembers`, `BanMembers`, and `ManageGuild` in **all 9 guilds**. Bot's role position is 60–78 across guilds — high enough to manage most non-leadership roles, but not at the top. This is fine for normal operation; flag if you want the bot's role moved up to manage Founder/leadership-tier roles.
