import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { startRecording, stopRecording, isRecording } from '../services/recordingService.js';
import { hasPortalAuth } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Voice recording system — record meetings with separate tracks per speaker')
  .addSubcommand(sub =>
    sub.setName('start')
      .setDescription('Start recording a voice channel')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Voice channel to record (default: your current channel)')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('stop')
      .setDescription('Stop the current recording')
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('View recent recordings for this server')
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === 'start') {
    if (!await hasPortalAuth(interaction.user.id, 5)) {
      return interaction.editReply({ content: '❌ You need authorisation level 5+ to start recordings.' });
    }

    const voiceChannel = interaction.options.getChannel('channel') || interaction.member.voice?.channel;
    if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
      return interaction.editReply({ content: '❌ Please specify a voice channel or join one first.' });
    }

    if (isRecording(interaction.guild.id)) {
      return interaction.editReply({ content: '❌ A recording is already active in this server. Use `/record stop` first.' });
    }

    try {
      const { recordingId, recordingKey, accessCode } = await startRecording(voiceChannel, interaction.user);

      const startTs = Math.floor(Date.now() / 1000);

      // DM the starter
      await interaction.user.send({
        embeds: [new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('🔴 Recording Started')
          .setDescription(`Recording is now active in **${voiceChannel.name}**.`)
          .addFields(
            { name: '🔑 Access Code', value: `**${accessCode}**`, inline: true },
            { name: 'Recording ID', value: `\`${recordingKey}\``, inline: true },
            { name: 'Started', value: `<t:${startTs}:F>`, inline: true },
            { name: 'Retention', value: '7 days', inline: true },
            { name: 'Download', value: '[portal.communityorg.co.uk/recordings](https://portal.communityorg.co.uk/recordings)', inline: true },
          )
          .setFooter({ text: 'Enter your code at the portal to download individual tracks or a merged mix' })
          .setTimestamp()
        ]
      }).catch(() => {});

      await interaction.editReply({ content: `✅ Recording started in **${voiceChannel.name}**. Check your DMs for details.` });

      // Announce in text channel
      await interaction.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('🔴 Recording in Progress')
          .setDescription(`**${interaction.user.tag}** has started a recording in **${voiceChannel.name}**.\n\nAll participants will be recorded on separate tracks. Use \`/record stop\` to end.\n\nAn access code has been sent via DM — files can be downloaded at [portal.communityorg.co.uk/recordings](https://portal.communityorg.co.uk/recordings).`)
          .setFooter({ text: 'CO Recording System' })
          .setTimestamp()
        ]
      }).catch(() => {});

    } catch (e) {
      await interaction.editReply({ content: `❌ Failed to start recording: ${e.message}` });
    }
  }

  else if (sub === 'stop') {
    if (!isRecording(interaction.guild.id)) {
      return interaction.editReply({ content: '❌ No active recording in this server.' });
    }

    try {
      const { recordingId, recordingKey, participants, recordingDir, durationSecs } = await stopRecording(interaction.guild.id);

      const durationStr = `${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s`;

      const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recordingId);
      const expiresTs = Math.floor(new Date(rec.expires_at).getTime() / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ Recording Complete')
        .setDescription(`Recording from **${rec.channel_name}** is ready.`)
        .addFields(
          { name: 'Duration', value: durationStr, inline: true },
          { name: 'Participants', value: String(participants.length), inline: true },
          { name: 'Expires', value: `<t:${expiresTs}:R>`, inline: true },
          { name: 'Tracks', value: participants.map(p => `• ${p.username}`).join('\n') || 'None', inline: false },
          { name: 'Files', value: `\`${recordingDir}\``, inline: false },
        )
        .setFooter({ text: 'Files are kept for 7 days then automatically deleted.' })
        .setTimestamp();

      // DM the starter
      const starter = await interaction.client.users.fetch(rec.started_by).catch(() => null);
      if (starter) await starter.send({ embeds: [embed] }).catch(() => {});
      if (interaction.user.id !== rec.started_by) {
        await interaction.user.send({ embeds: [embed] }).catch(() => {});
      }

      await interaction.editReply({ content: `✅ Recording stopped. ${participants.length} track(s) saved. Duration: **${durationStr}**. Check your DMs.` });

      await interaction.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle('⏹️ Recording Ended')
          .setDescription(`Recording stopped by **${interaction.user.tag}**. Duration: **${durationStr}**. ${participants.length} participant track(s) saved.`)
          .setFooter({ text: 'CO Recording System' })
        ]
      }).catch(() => {});

    } catch (e) {
      await interaction.editReply({ content: `❌ Failed to stop recording: ${e.message}` });
    }
  }

  else if (sub === 'list') {
    const recordings = db.prepare(`
      SELECT r.*, GROUP_CONCAT(rp.username, ', ') as participants_list
      FROM recordings r
      LEFT JOIN recording_participants rp ON rp.recording_id = r.id
      WHERE r.guild_id = ? AND r.status != 'deleted'
      GROUP BY r.id
      ORDER BY r.started_at DESC
      LIMIT 10
    `).all(interaction.guild.id);

    if (recordings.length === 0) {
      return interaction.editReply({ content: 'No recordings found for this server.' });
    }

    const lines = recordings.map(r => {
      const startTs = Math.floor(new Date(r.started_at).getTime() / 1000);
      const dur = r.duration_seconds ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s` : 'In progress';
      const status = r.status === 'recording' ? '🔴 Recording' : r.status === 'ready' ? '✅ Ready' : r.status === 'processing' ? '⏳ Processing' : '🗑️ Deleted';
      return `**${r.channel_name}** — <t:${startTs}:R>\n${status} · ${dur} · ${r.participant_count} tracks\n\`${r.recording_key}\``;
    });

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎙️ Recent Recordings')
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: 'CO Recording System' })
      ]
    });
  }
}
