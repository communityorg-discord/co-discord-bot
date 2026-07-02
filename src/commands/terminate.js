// COMMAND_PERMISSION_FALLBACK: fsa
// Network-aware termination.
//   USGRP  → full network removal (FSA-gated): kick from every network server,
//            strip verified roles in the main server, remove from the network
//            verified list, and vacate their seat on the hierarchy site.
//   CO     → the original CO staff termination (kick across guilds + infraction).
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand, requiresSuperuserWarning } from '../utils/permissions.js';
import { terminateAcrossGuilds } from '../utils/roleManager.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { TERMINATE_LOG_CHANNEL_ID, IS_USGRP } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import botDb from '../utils/botDb.js';
import { isFSA } from '../utils/usgrpAuthority.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('terminate')
  .setDescription('Terminate a staff member — strip roles, remove from servers + the hierarchy')
  // reason is required, so it must come before the optional user/userid options.
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for termination').setRequired(true))
  .addUserOption(opt => opt.setName('user').setDescription('Staff member (if still in a server)').setRequired(false))
  .addStringOption(opt => opt.setName('userid').setDescription('Their Discord ID — use if they have left the server').setRequired(false));

export async function execute(interaction) {
  return IS_USGRP ? executeNetwork(interaction) : executeCO(interaction);
}

// Resolve the target from either the user picker or a raw ID (for people who
// have already left every server). Returns { id, user } (user may be null).
async function resolveTarget(interaction) {
  const picked = interaction.options.getUser('user');
  if (picked) return { id: picked.id, user: picked };
  const raw = (interaction.options.getString('userid') || '').replace(/[^0-9]/g, '');
  if (!raw) return { id: null, user: null };
  const user = await interaction.client.users.fetch(raw).catch(() => null);
  return { id: raw, user };
}

// ── USGRP: full network termination ──────────────────────────────────────────
async function executeNetwork(interaction) {
  if (!await isFSA(interaction.user.id)) {
    return interaction.reply({ content: `${E.cross} Only a member of the **FSA** can terminate network staff.`, ephemeral: true });
  }
  const { id: targetId, user: targetUser } = await resolveTarget(interaction);
  const reason = interaction.options.getString('reason');
  if (!targetId) {
    return interaction.reply({ content: `${E.cross} Give me who to terminate — pick a **user**, or paste their **userid** if they've already left the server.`, ephemeral: true });
  }
  if (requiresSuperuserWarning(targetId)) {
    return interaction.reply({ content: `${E.cross} <@${targetId}> is a Superuser and cannot be terminated.`, ephemeral: true });
  }

  await interaction.deferReply();

  // DM the member first (before we strip everything) — only if reachable.
  if (targetUser) {
    try {
      await targetUser.send({ embeds: [new EmbedBuilder()
        .setColor(0xB91C1C)
        .setTitle('Removed from the network')
        .setDescription(`${E.terminate} You have been removed from the ${BRAND.name} network staff team.`)
        .addFields(
          { name: 'Reason', value: String(reason).slice(0, 1024) },
          { name: 'Effective', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp()
      ] });
    } catch {}
  }

  const { doTermination } = await import('../serverAccess/actions.js');
  const r = await doTermination(interaction.client, {
    userId: targetId, byId: interaction.user.id, byName: interaction.user.username, reason,
  });

  // Disable their USGRP email account (keeps the mailbox; blocks login).
  let mailDisabled = false;
  try {
    const { disableMailbox } = await import('../utils/usgrpMail.js');
    const dr = await disableMailbox(targetId);
    mailDisabled = !!dr?.ok;
  } catch (e) {
    if (e?.message !== 'no_account_for_user') console.error('[terminate] mail disable failed:', e?.message);
  }

  // Refresh the #structure org-chart messages (the verified-list removal already
  // vacated their seat in structure.json via the verify engine). Background.
  (async () => {
    try {
      const { createRequire } = await import('node:module');
      const { updateStructure } = createRequire(import.meta.url)('/home/vpcommunityorganisation/clawd/services/hierarchy-admin/scripts/post-network-structure.cjs');
      const res = await updateStructure({ token: process.env.DISCORD_BOT_TOKEN, channelId: '1516284990168764586' });
      console.log(`[terminate] #structure refreshed: ${JSON.stringify(res)}`);
    } catch (e) { console.error('[terminate] structure refresh failed:', e?.message); }
  })();

  const lines = [
    `${E.terminate} **<@${targetId}> (\`${targetId}\`) has been terminated from the network.**`,
    `${E.server} Kicked from **${r.kicked.length}** server(s)${r.kickFailed.length ? ` — couldn't kick from: ${r.kickFailed.join(', ')}` : ''}.`,
    `${E.role} Roles stripped in **${r.stripped.length}** server(s).`,
    `${r.unverified ? E.check : E.warning} ${r.unverified ? 'Removed from the network verified list + hierarchy.' : 'Could not remove from the verified list — check manually.'}`,
    `${mailDisabled ? E.check : E.warning} ${mailDisabled ? 'USGRP email account disabled.' : 'No USGRP email account to disable (or disable failed).'}`,
  ];
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setColor(0x7F1D1D)
    .setAuthor({ name: 'Network Staff Terminated', iconURL: BRAND.logo })
    .setThumbnail(targetUser ? targetUser.displayAvatarURL() : null)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: `${E.member} Member`, value: `<@${targetId}>`, inline: true },
      { name: `${E.staff} Actioned by`, value: `<@${interaction.user.id}>`, inline: true },
      { name: `${E.gavel} Reason`, value: String(reason).slice(0, 1024), inline: false }
    )
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp()
  ] });
}

// ── CO: original staff termination ────────────────────────────────────────────
async function executeCO(interaction) {
  const perm = await canUseCommand('terminate', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  const { id: targetId, user: targetUser } = await resolveTarget(interaction);
  const reason = interaction.options.getString('reason');
  if (!targetId) {
    return interaction.reply({ content: `${E.cross} Give me who to terminate — pick a **user**, or paste their **userid** if they've left.`, ephemeral: true });
  }

  if (requiresSuperuserWarning(targetId)) {
    return interaction.reply({ content: `${E.cross} <@${targetId}> is a Superuser and cannot be terminated.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(targetId);
  const displayName = portalUser?.display_name || targetUser?.username || targetId;
  await interaction.deferReply();

  if (targetUser) {
    try {
      await targetUser.send({
        embeds: [new EmbedBuilder()
          .setTitle('Employment Terminated')
          .setColor(0xEF4444)
          .setDescription(`${E.terminate} Your employment with ${BRAND.name} has been terminated.`)
          .addFields(
            { name: 'Reason', value: reason },
            { name: 'Effective', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
          )
          .setFooter({ text: BRAND.name })
          .setTimestamp()
        ]
      });
    } catch {}
  }

  await terminateAcrossGuilds(interaction.client, targetId, botDb);
  const inf = addInfraction(targetId, 'termination', reason, interaction.user.id, interaction.user.username, null, 0);

  await logAction(interaction.client, {
    action: 'Staff Terminated',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: displayName },
    reason, color: 0x7F1D1D,
    specificChannelId: TERMINATE_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.terminate',
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('Staff Terminated')
    .setColor(0x7F1D1D)
    .setDescription(`${E.terminate} **${displayName}** has been terminated.`)
    .addFields(
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: interaction.user.username, inline: true },
      { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true }
    )
    .setFooter({ text: BRAND.name })
    .setTimestamp()
  ]});
}
