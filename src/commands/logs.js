// COMMAND_PERMISSION_FALLBACK: superuser_only
// /logs — pick which logs post in the current channel. Run it in more than one
// channel/server to fan a type out. Dion + Evan always get every log in their
// DMs as well (handled in logger.js / sendToWatchedUsers).
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { setGlobalLogChannel, getGlobalLogChannel, removeGlobalLogChannel } from '../utils/botDb.js';
import { SUPERUSER_IDS } from '../config.js';
import { E } from '../lib/emoji.js';

// Broad, plain-English types -> the per-server catch-all category they bind.
const TYPES = [
  { name: 'Moderation (bans, warns, suspensions)', value: 'moderation' },
  { name: 'Verification & members joining', value: 'verification' },
  { name: 'Messages (edits & deletes)', value: 'message' },
  { name: 'Roles', value: 'role_management' },
  { name: 'Members (join / leave)', value: 'membership' },
  { name: 'Staff & misc', value: 'misc' },
  { name: 'Email', value: 'email' },
  { name: 'Everything', value: 'everything' },
];
const LABEL = Object.fromEntries(TYPES.map(t => [t.value, t.name]));
const ALL = TYPES.filter(t => t.value !== 'everything').map(t => t.value);
const cats = (type) => type === 'everything' ? ALL : [type];

export const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Choose which logs post in a channel.')
  .addSubcommand(s => s.setName('set').setDescription('Send a log type to THIS channel.')
    .addStringOption(o => o.setName('type').setDescription('What to log here').setRequired(true).addChoices(...TYPES)))
  .addSubcommand(s => s.setName('remove').setDescription('Stop sending a log type to THIS channel.')
    .addStringOption(o => o.setName('type').setDescription('What to stop').setRequired(true).addChoices(...TYPES)))
  .addSubcommand(s => s.setName('list').setDescription('Show where each log type is going in this server.'));

export async function execute(interaction) {
  if (!SUPERUSER_IDS.includes(interaction.user.id)) {
    return interaction.reply({ content: 'Not authorised.', flags: 64 });
  }
  const sub = interaction.options.getSubcommand();
  const gid = interaction.guildId;
  if (!gid) return interaction.reply({ content: 'Run this in a server channel.', flags: 64 });

  if (sub === 'list') {
    const lines = TYPES.filter(t => t.value !== 'everything').map(t => {
      const ch = getGlobalLogChannel('global_' + t.value, gid);
      return `**${t.name}** — ${ch ? `<#${ch}>` : '_not set_'}`;
    });
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Log channels in this server')
      .setDescription(`${E.logs} ${lines.join('\n')}`)
      .setFooter({ text: 'Dion + Evan also get every log in their DMs.' });
    return interaction.reply({ embeds: [embed], flags: 64 });
  }

  const type = interaction.options.getString('type', true);
  if (sub === 'set') {
    for (const c of cats(type)) setGlobalLogChannel('global_' + c, interaction.channelId, gid);
    return interaction.reply({ content: `${E.check} **${LABEL[type]}** logs will now post in this channel. Run the same command in other channels/servers to add more.`, flags: 64 });
  }
  // remove
  let removed = 0;
  for (const c of cats(type)) removed += removeGlobalLogChannel('global_' + c, gid) || 0;
  return interaction.reply({ content: removed ? `Stopped **${LABEL[type]}** logs in this channel.` : `**${LABEL[type]}** logs weren’t set here.`, flags: 64 });
}
