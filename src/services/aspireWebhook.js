// Aspire Webhook — notify Aspire Citizen Portal when a USGRP member
// receives the Citizen role. Aspire then upserts a pending citizen row
// so the user has a record before they ever click /register.
//
// Configured via env:
//   ASPIRE_WEBHOOK_URL=http://localhost:3019/api/internal/citizen-role-granted
//   ASPIRE_INTERNAL_TOKEN=...                (must match Aspire Portal)
//   ASPIRE_USGRP_GUILD_ID=...                (only fire for this guild)
//   ASPIRE_CITIZEN_ROLE_ID=...               (only fire when this role is added)
//
// If any of these are unset, the watcher silently no-ops — safe to deploy
// before USGRP is rebuilt and the IDs are known.

const URL = process.env.ASPIRE_WEBHOOK_URL || 'http://localhost:3019/api/internal/citizen-role-granted';

export function setupAspireWebhook(client) {
    const guildId = process.env.ASPIRE_USGRP_GUILD_ID;
    const roleId = process.env.ASPIRE_CITIZEN_ROLE_ID;
    const token = process.env.ASPIRE_INTERNAL_TOKEN;

    if (!guildId || !roleId || !token) {
        console.log('[aspire-webhook] not configured (missing guild/role/token) — listener disabled');
        return;
    }

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            if (newMember.guild.id !== guildId) return;
            const had = oldMember.roles.cache.has(roleId);
            const has = newMember.roles.cache.has(roleId);
            if (had || !has) return;

            const r = await fetch(URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    discord_id: newMember.id,
                    username: newMember.user.username,
                }),
            });
            if (!r.ok) {
                console.error(`[aspire-webhook] POST failed: ${r.status} ${await r.text()}`);
                return;
            }
            console.log(`[aspire-webhook] notified for ${newMember.user.username} (${newMember.id})`);
        } catch (err) {
            console.error('[aspire-webhook] error:', err);
        }
    });

    console.log(`[aspire-webhook] listening on guild ${guildId} for role ${roleId}`);
}
