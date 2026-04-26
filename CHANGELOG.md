# CO Staff Portal — Changelog

All notable changes to the CO Staff Portal and the CO Discord bot. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — themes over raw commit dump.

## Release timeline

The same body of work shipped through three staged tags so we have rollback points if something regresses:

| Tag | Date | Stage | Headline |
|---|---|---|---|
| `v1.0.0-alpha` | 2026-04-13 | Initial cut | First end-to-end working portal: switchboard, helpdesk, cases, onboarding, leave |
| `v1.0.0-beta`  | 2026-04-19 | Feature-complete | All major features in, accumulating real usage + the first bug reports |
| `v1.0.0`       | 2026-04-26 | **Production stable** | Hardened, audited, documented for handover. Access control rebuilt, bot permissions wired, silent corruption fixed |

Across the alpha → production window we landed **1,005 commits on the portal + 41 on the bot** (1,581 portal commits and 380 bot commits lifetime).

---

## [v1.0.0] — 2026-04-26 · Production Stable

The CO Staff Portal exits beta. **Everything in this release has been hardened, audited, and documented for handover.**

Below is what landed across the three staged releases, organised by surface (rather than a 1,000-line commit dump).

### 🛡 Access Control — completely rebuilt

Single source of truth for who-sees-what across the portal.

- **Feature catalogue** with three tiers — minLevel **1** for personal/own-data items, **7** for management surfaces, **99** for superuser-only. Anything below the floor is auto-denied unless explicitly granted via the admin panel.
- **Four-layer cascade** for every permission check (user > department > auth_level > catalogue). Used by both the frontend `canSee()` hook and the backend `requireFeature()` middleware — gating decisions can no longer disagree between the UI and the API.
- **`requireFeature(key)` middleware** wired into ~215 routes across cases, helpdesk, disciplinary, transfers, switchboard, leave, staff_management.
- **Buttons rewired** to `canSee()` in the worst-offender pages so a granted feature actually unlocks the actions, not just the page.
- **Permission Sandbox** — debug "if user X looked at feature Y, would they see it?" with the live cascade. Mounted in Admin Panel.
- **Superusers tab** — manage permanent (hardcoded), explicit (auth-99 in users table), and temporary grants in one place. Live countdowns on temp grants. dionm + evans undeletable.
- **Bot Permissions tab** — every Discord slash command listed with its current grant rule. Edit who can run each command (per-user + per-role + per-subcommand). Same DB-backed source of truth as the bot's `canUseCommand()` runtime check.
- **Team Pools tab** — round-robin pools (IT helpdesk, Switchboard DCOS) editable from the UI. Mirrored as Settings tabs in IT and Switchboard.
- **My Profile tab** — Evan/Dion can edit their own auth_level/position/department/etc since the normal preferences page can't.
- **Pages (WIP) tab** — admin-managed list of paths that show the WIP gate. Replaces the per-route hardcoded gating. Gate now renders inside the layout (sidebar stays visible) and the Access PIN reveals the real page on unlock.

### 🧠 Atlas — the AI assistant

- Universal floating bubble. Listens for `open-atlas` window events so any "Ask Atlas" surface can deep-link in place.
- Aware of every change shipped on the portal — pulled from a shared AI-memory store that all AI surfaces also read.
- Knows about IT helpdesk routing — won't suggest raising a case for an IT issue. Suggests the helpdesk instead.
- Smart navigation actions — Atlas can now NAVIGATE_TO a page, OFFER_INVESTIGATION on a case, PREPARE_ACTION ahead of a click, FOLLOWUPS that surface as task list items.
- Memory layer: `addMemory()` API + scope-keyed retrieval. "Remember: …" in any chat persists a fact; future conversations across all AI surfaces use it.

### 📨 Switchboard — central email triage

The biggest feature surface in this release. Replaces ad-hoc inbox checking with a triage queue.

- **9 shared mailboxes** polled via Microsoft Graph webhooks. Every inbound thread becomes a switchboard ticket with a `DMSPC-` / `DCOS-` ref.
- **AI-classified** on arrival — category, suggested action, sentiment, leave-subtype detection, RTW stage detection, resignation stage detection, transfer stage detection, wellbeing concern severity, helpdesk handoff hint, IT redirect hint, CC information-copy detection.
- **Auto-reply pipeline** — leave subtype questions, simple acknowledgements, and resignation receipts can be answered automatically (admin-toggled per category).
- **Round-robin auto-assignment** into the DCOS triage pool (admin-managed via Switchboard Settings).
- **Reply composer** — rich text, AI-drafted suggestions, canned templates, attachments, signature.
- **Forward-to-team** modal — hand a ticket to a different mailbox.
- **Convert to case** modal — turn an email into a Case with full subject context.
- **Convert to IT helpdesk ticket** — handoff with a stamped `linked_sw_ticket_ref` so both sides reference the other.
- **Search** — full-text across every ticket, message, and attachment metadata.
- **Analytics** — volume by mailbox, response times, AI auto-handle rates, SLA breaches.
- **AI Activity** log — every AI classification, auto-reply, and override across switchboard tickets.
- **Sender context card** — pulls everything we know about the sender (active leave, open cases, training status) inline next to the thread.
- **AI Guidance panel** — flags sensitive categories that need a human flag before acting.
- **Triage view filters** — Awaiting first response / Awaiting sender response / All in triage / Mine / Urgent / SLA / Unassigned / Flagged / Stalled.
- **Subject blackout** when there's a suspended/blocked subject; superuser bypass.
- **Per-mailbox access control** — operators only see mailboxes they're a member of.

### 🎫 Help Desk — IT support workflow

- **Round-robin auto-assignment** to the IT team pool (admin-managed via IT Settings).
- **Escalation chain** — level 1 escalates to deputy, level 2 to director.
- **AI triage** on creation — suggested category, priority, severity, summary.
- **Ticket templates** — pre-built forms for common issue types.
- **Canned responses** — pre-written reply blocks the IT team can drop in.
- **Knowledge-base articles** — admin-edited, surfaced in the helpdesk and via Atlas.
- **CSAT survey** on resolution — public token-link the user can rate from email.
- **Internal notes** vs visible replies, with proper notification fan-out only to the IT team (never to all auth-6+).
- **Status history** with reasons, every state change audited.
- **Reset portal password / Force logout** quick actions on the agent side.
- **Multi-channel ingest** — portal form, email-in via the IT mailbox, in-Discord via `/helpdesk new`.
- **AI-drafted replies** sent from the portal display as "Claude (AI assistant)" to the requester (not as the agent).

### 📁 Cases — disciplinary, performance, leave, etc.

- **22 chat-action kinds** the AI can offer in the case AI panel (file_to_personnel, switchboard_reply, generate_letter, offboarding actions, activity points actions, …). Each kind gates on a confirm step where a human signs off before the action fires.
- **Case-detail per-type tabs** (Overview, Timeline, Letters, Evidence, Fact Finding, Hearing, Appeal) — each case type only shows the tabs that apply.
- **Disciplinary track** with NID (Non-Investigational Disciplinary) flow + full investigation path.
- **Letter integration** — issue letters from inside a case, every letter pre-fills placeholders from case + subject context.
- **Offboarding panel** with full checklist (email disabled / drive revoked / discord roles stripped / etc.) + bot-driven role removal across all 9 servers.
- **APS (activity points) disciplinary integration** — adjustments and deductions flow through cases.
- **Case AI panel** with per-case context, recall, action confirmation, and audit-stamped result summaries.
- **Subject context card** showing the staff member's active leave, open cases, training, position, line manager — inline.
- **Case timeline** with actor attribution on every event; UTC-correct timestamps after the parseServerTs fix.
- **Evidence uploads** with drag-drop, per-file privacy levels.
- **Appeal flow** — file from `/my-disciplinary-cases`, evidence upload, decision panel for reviewers.
- **Race-fix on case_number generation** — concurrent submissions no longer collide.

### 📜 Letters

- **37 letter templates** with full placeholder coverage (subject details, line manager, position, dates, employee number, custom fields per type).
- **AI-drafted letters** with context-aware placeholder filling. AI knows every placeholder for every letter and asks for missing data before generating.
- **PDF render + Drive archive** on every issued letter.
- **Letter management admin** — list every letter, void/regenerate, audit log.
- **Per-staff Letters tab** in the dossier modal showing every letter ever issued to that person.

### 👥 Staff Directory + Dossier

- **Hierarchy diagram** with normalised position matching (commas/punctuation/filler words ignored). Renders live postholders, not a static node tree.
- **Staff dossier modal** with Profile / Leave / Documents / Letters / Probation / Activity tabs. Documents tab shows the Drive folder link. Probation tab opens the in-place ProbationDetailDrawer.
- **Department filter** uses hierarchical position lists (not flat).
- **Search** by name, username, position, department, employee number.
- **Edit profile / Reset password / Force logout** quick actions, gated by auth level.
- **Danger zone** — suspend/terminate/delete/reactivate behind a typed-confirm gate.

### 💼 My Team (managers + direct reports)

- **Team list** with inline status pills, avatar, last activity.
- **Pending Actions** queue — leave/transfer/case items awaiting the manager's decision for their reports.
- **Probation tracking** with milestone records and supervisor sign-offs.
- **Performance & Reviews** — issue formal reviews, schedule 1:1s, log conversations.
- **TeamMemberCard modal** — drill into one report with Profile / Performance / Leave / Training tabs.

### 🎓 Onboarding + Training

- **First-login flow** with a guided dossier walk-through, mandatory acknowledgements, profile setup.
- **Standards Agreement** signing pipeline — staff signs, then queued for counter-signature by Dion or Evan (first-to-counter wins). PDF burned and archived to Drive.
- **Counter-Sign Queue** widget surfaces both awaiting-counter and awaiting-staff Standards Agreements with reminder + admin-override actions.
- **Training modules** with progress tracking, learning paths, certificates.
- **Module Builder** (superuser-only) for authoring + versioning training content.
- **Module Timing** analytics — how long staff spend on each module.
- **Universal track quiz** rewritten with CO-specific scenario questions and edge cases.
- **Onboarding pack** dispatcher emails the welcome bundle on first-login completion.

### 🏖 Leave Management

- **Annual + wellbeing + personal leave** with per-staff balance tracking.
- **Pro-rated allowance** calculation based on join date (formula: `min(66, 56 + years_of_service × 2)`, minus shutdown deduction).
- **Mass leave-doc updates** queue for HR admin.
- **Date-change requests** flow with approve/decline.
- **Wellbeing day queue** for review.
- **Return-to-Work** interview scheduling and outcome recording.
- **Discord LOA role** auto-applied across all 9 guilds when leave starts; restored when it ends.
- **Acting position** assignment that swaps Discord roles in the original member's place during their leave.

### 🚪 Resignation + Offboarding

- **Phase-driven journey UI** — Submitted → Approved → Handover → Exit Interview → Completed visible at the top of the user's resignation page.
- **Handover notes** + **exit interview** + **leaver checklist** as separate forms, each saving independently.
- **DMSPC review** with approve / decline / request-cancel approval flow.
- **Service letter PDF** + **farewell pack PDF** on completion.
- **Manage tab** redesigned to match the new aesthetic.

### 📊 Performance + Activity Points

- **Per-staff weekly grade** computed from points + categories met, against a base tier and active adjustments. BRAG colour returned per week.
- **Activity claims queue** for manual point-claim review (voice sessions, meetings, tasks, etc.).
- **Performance adjustments** — issue plus/minus with reason, approval requirements per amount.
- **Manual deductions** flow.
- **Auto sync from the bot**: messages, voice time, daily active, available status, welcome reactions — all categorised, capped, and stored as `activity_point_records`. Bot now sends DELTAS (not cumulative) — fixed silent corruption that was inflating everyone's weekly totals into the cap.

### 📰 News (Loop)

- **Feed** with posts, threaded comments, reactions.
- **Newsletters** — compose, schedule, publish, email out via Brevo.
- **Broadcast** — pin a notice to the top of the feed.
- **News article detail** as a full-page route, deep-linkable.

### 🗒 Standards & Compliance (IAC)

- **Memo log** with detail drawer (Overview / Events / Disputes / PDF / Acknowledgements).
- **Notices** — formal IAC communications.
- **Audits** — IAC audit records with evidence + findings.
- **Bi-monthly reports** — submission, list, timeline, disputes.
- **Membership** — roster + onboarding tracker.
- **GDPR** — data subject access requests, verification, export, delivery.

### 🔧 Admin Panel — rebuilt

Stripped six tabs that duplicated dedicated pages. Kept the genuinely-admin-only ones. Added four new editable tools:

- **System Status** — portal/bot health, DB row counts, last 20 errors, restart-bot / force-resync-Drive / force-poll-mailbox actions.
- **Power Tools** — pick-user one-click actions: force logout, reset password, provision Drive folder, mint dev JWT (debug/support only).
- **User Editor** — direct row-edit any user (display_name, email, position, department, auth_level, account_status, probation, line manager, notes) with diff preview; permanent-superuser protection blocks demoting dionm/evans/haydend below 99.
- **Authorisation Codes** — generate + manage one-off invitation/reset codes.
- Background Tasks, Work Logs, Security, Case Templates, Overview kept.

### 🤖 Discord Bot

- **60+ slash commands** all routing through a central `canUseCommand(name, interaction)` permission helper. Source of truth for who can run each command lives in the `command_permissions` table managed via Access Control → Bot Permissions.
- **Subcommand-level + option-level permissions** (e.g. grant `/acting start` separately from `/acting end`; restrict `/dm mass`).
- **Office voice channel system** — managed channels with allowlists, request feed, waiting rooms, kick-on-non-allowlisted, pending request approval flow.
- **Activity tracking** — voice sessions logged across all 9 guilds, daily active users, message counts per BRAG week, welcome detection, available-status detection.
- **Acting position assignment** with role swap across all 9 guilds, immediate or queued for midnight, pending-row drainer endpoint.
- **Cross-guild nickname** management endpoint.
- **Webhook surface** for portal → bot operations: leave start/end role swap, offboarding role strip, DM with attachment, set nickname, process pending acting, send channel notification, role assign/unassign/position/permissions, force-verify, dispatch CSAT survey, handle escalation.
- **Health monitoring** — bot pings the portal every 5 minutes; portal logs the bot's last-seen.

### 🐛 Notable bugs fixed

- **`activity_point_records` silent inflation** — UNIQUE constraint included a nullable `claim_id`, and SQLite NULL ≠ NULL → bot's per-minute cumulative sync inserted a new row each tick instead of updating. Capped at category cap so no overflow but everyone's weekly totals were silently inflated. Migration deduped + added a partial unique index; bot rewritten to send deltas with a synced cursor.
- **Office allowlist wiped on every bot restart** — a `DROP TABLE IF EXISTS office_allowlist` left over from an old migration was clobbering live data.
- **Standards-agreement signing 500** — the document_signatures table had both legacy `user_id` and newer `signer_user_id` columns; route only populated the newer one and tripped NOT NULL.
- **GlobalWipGuard blank-page bug** — wrapping `<Routes>` from outside the layout, plus passing `<div />` as children, broke both the layout AND the unlock-reveal. Moved into PortalLayout.
- **Schema drift** — multiple routes still queried retired tables (`brag_reports`, `brag_records`). Repointed to `activity_weekly_grades` / `activity_point_records`.
- **Dead `<a href>` audit** — 11 navigation targets pointing at renamed/non-existent routes (`/cases/new`, `/atlas`, `/activity-points`, `/staff-directory`, etc.) all repointed.
- **Bot `dailyActiveUsers / voiceSessions / welcomeTracker is not defined`** — declared inside the `'ready'` callback but referenced by top-level event handlers. Hoisted to module scope.
- **Light theme** — bulk CSS overrides for hardcoded white-text classes + per-component fixes for inline `#fff` text in StaffDirectory, ExecutiveOperationsPage, StaffProfileDossier, CaseSidebar, PolicyPage.
- **Probation auth-level discrepancy** — `getEffectiveUser()` (the /api/auth/me builder) wasn't applying temp superuser elevation, so the dashboard saw the wrong level even though the backend routes honoured the elevation correctly.
- **Counter-sign queue** widget now also surfaces awaiting-staff-signature Standards Agreements, not just awaiting-counter.

### 🗂 Documentation

- **System handover PDF** generator (`scripts/generate-system-pdf.js`) producing an ~80-page reference covering architecture, schema, routes, frontend, AI systems, integrations, recent changes. Source markdown in `data/system-docs/markdown/`.
- **Permissions reference PDF + CSV + Google Sheet** (`scripts/generate-permissions-docs.js` + `scripts/upload-permissions-sheet.js`) describing every catalogue key with what it grants.
- **Updated CLAUDE.md** with the post-refactor architecture, three data-corruption traps to watch, and the activity-sync no-regression rule.

---

## [v1.0.0-beta] — 2026-04-19

Feature-complete cut. Every major surface in this release was working end-to-end; the next week was about hardening, integrating, and removing rough edges. Notable from this stage: full Switchboard pipeline including AI auto-handle paths, Helpdesk multi-channel ingest, Case AI's 22 chat-action kinds, the onboarding signing flow, leave Discord-role swap. Tag commit: `90fecf6` (portal) / `9d20129` (bot).

## [v1.0.0-alpha] — 2026-04-13

First end-to-end working portal. Switchboard triage, helpdesk basics, cases foundation, onboarding flow, leave management all in place but rough. Tag commit: `6ab410c` (portal) / `9a2e9de` (bot).

---

## Versioning

We're now on **v1.0.0**. Future minor changes will land on `v1.x.y` per [Semantic Versioning](https://semver.org/) — patch for fixes, minor for additive features, major for breaking changes. Pre-release iterations follow the alpha → beta → rc → stable pattern.
