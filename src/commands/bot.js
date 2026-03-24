import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const startTime = Date.now();

const STAFF_IDS = {
  developer: '723199054514749450',
  internalBotManagement: '415922272956710912',
  superusers: '1013486189891817563',
  internalBotStaff: '723199054514749450',
};

export const data = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Information about the CO Bot');

export async function execute(interaction) {
  await interaction.deferReply();

  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  // Fetch all IDs concurrently
  const memberMap = await fetchMembers(interaction, Object.values(STAFF_IDS));

  const formatMember = (id) => {
    const member = memberMap.get(id);
    const nickname = member?.nickname || member?.user?.globalName || member?.user?.username || `Unknown`;
    return `${nickname} | ${id}`;
  };

  const embed = new EmbedBuilder()
    .setTitle('🤖 CO Staff Bot')
    .setColor(0x5865F2)
    .setThumbnail(interaction.client.user.displayAvatarURL())
    .addFields(
      { name: 'Developer', value: formatMember(STAFF_IDS.developer), inline: false },
      { name: 'Internal Bot Management', value: formatMember(STAFF_IDS.internalBotManagement), inline: false },
      { name: 'Superusers', value: formatMember(STAFF_IDS.superusers), inline: false },
      { name: 'Internal Bot Staff', value: formatMember(STAFF_IDS.internalBotStaff), inline: false }
    )
    .addFields(
      { name: '\u200B', value: '\u200B' },
      { name: 'Version', value: 'v1.1.0', inline: true },
      { name: 'Phase', value: 'V1.0-1.1', inline: true },
      { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
      { name: 'Servers', value: String(interaction.client.guilds.cache.size), inline: true },
      { name: 'Ping', value: `${interaction.client.ws.ping}ms`, inline: true }
    )
    .setFooter({ text: 'Community Organisation | Internal Bot' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function fetchMembers(interaction, ids) {
  const memberMap = new Map();
  const uniqueIds = [...new Set(ids)];

  const fetches = uniqueIds.map(id =>
    interaction.guild.members.fetch(id).catch(() => null)
  );

  const results = await Promise.all(fetches);
  results.forEach((member, i) => {
    if (member) memberMap.set(uniqueIds[i], member);
  });

  return memberMap;
}
