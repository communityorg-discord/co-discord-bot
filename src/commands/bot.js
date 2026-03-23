import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { SUPERUSER_IDS } from '../config.js';

const startTime = Date.now();

export const data = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Information about the CO Bot');

export async function execute(interaction) {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  const embed = new EmbedBuilder()
    .setTitle('🤖 CO Staff Bot')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Version', value: 'v1.1.0', inline: true },
      { name: 'Phase', value: 'V1.0-1.1', inline: true },
      { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
      { name: 'Servers', value: String(interaction.client.guilds.cache.size), inline: true },
      { name: 'Ping', value: `${interaction.client.ws.ping}ms`, inline: true },
      { name: 'Superusers', value: SUPERUSER_IDS.map(id => `<@${id}>`).join(', '), inline: false },
      { name: 'Bot Developer', value: '<@723199054514749450>', inline: true }
    )
    .setFooter({ text: 'Community Organisation | Internal Bot' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
