// COMMAND_PERMISSION_FALLBACK: auth_level >= 7
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
  .addUserOption(opt => opt.setName('user').setDescription('Staff member to terminate').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for termination').setRequired(true));

export async function execute(interaction) {
  return IS_USGRP ? executeNetwork(interaction) : executeCO(interaction);
}

// ── USGRP: full network termination ──────────────────────────────────────────
async function executeNetwork(interaction) {
  if (!await isFSA(interaction.user.id)) {
    return interaction.reply({ content: `${E.cross} Only a member of the **FSA** can terminate network staff.`, ephemeral: true });
  }
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `${E.cross} <@${target.id}> is a Superuser and cannot be terminated.`, ephemeral: true });
  }

  await interaction.deferReply();

  // DM the member first (before we strip everything).
  try {
    await target.send({ embeds: [new EmbedBuilder()
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

  const { doTermination } = await import('../serverAccess/actions.js');
  const r = await doTermination(interaction.client, {
    userId: target.id, byId: interaction.user.id, byName: interaction.user.username, reason,
  });

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
    `${E.terminate} **<@${target.id}> has been terminated from the network.**`,
    `${E.server} Kicked from **${r.kicked.length}** server(s)${r.kickFailed.length ? ` — couldn't kick from: ${r.kickFailed.join(', ')}` : ''}.`,
    `${E.role} Roles stripped in **${r.stripped.length}** server(s).`,
    `${r.unverified ? E.check : E.warning} ${r.unverified ? 'Removed from the network verified list + hierarchy.' : 'Could not remove from the verified list — check manually.'}`,
  ];
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setColor(0x7F1D1D)
    .setTitle('Network Staff Terminated')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Reason', value: String(reason).slice(0, 1024), inline: false })
    .setFooter({ text: BRAND.footer })
    .setTimestamp()
  ] });
}

// ── CO: original staff termination ────────────────────────────────────────────
async function executeCO(interaction) {
  const perm = await canUseCommand('terminate', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');

  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `${E.cross} <@${target.id}> is a Superuser and cannot be terminated.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  await interaction.deferReply();

  try {
    await target.send({
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

  await terminateAcrossGuilds(interaction.client, target.id, botDb);
  const inf = addInfraction(target.id, 'termination', reason, interaction.user.id, interaction.user.username, null, 0);

  await logAction(interaction.client, {
    action: 'Staff Terminated',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason, color: 0x7F1D1D,
    specificChannelId: TERMINATE_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.terminate',
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('Staff Terminated')
    .setColor(0x7F1D1D)
    .setDescription(`${E.terminate} **${portalUser?.display_name || target.username}** has been terminated.`)
    .addFields(
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: interaction.user.username, inline: true },
      { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true }
    )
    .setFooter({ text: BRAND.name })
    .setTimestamp()
  ]});
}
