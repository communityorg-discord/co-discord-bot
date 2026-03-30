import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const startTime = Date.now();
const botVersion = 'v1.1.0';
const botPhase = 'V1.0-1.1';

const STAFF_IDS = [
  '723199054514749450', // Dion M.
  '415922272956710912', // Evan S.
  '1013486189891817563', // penguin
  '1355367209249148928',
  '878775920180228127',
];

export const data = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Information about the CO Bot');

export async function execute(interaction) {
  await interaction.deferReply();

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const startTimestamp = Math.floor(startTime / 1000);

  // Fetch all members concurrently
  const memberMap = await fetchMembers(interaction, STAFF_IDS);

  const formatMember = (id) => {
    const member = memberMap.get(id);
    const nickname = member?.displayName || member?.user?.globalName || member?.user?.username || `Unknown`;
    return `<@${id}> '${id}'`;
  };

  // All three users in every category
  const staffList = STAFF_IDS.map(id => formatMember(id)).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Bot Information')
    .setColor(0x000000)
    .setThumbnail(interaction.client.user.displayAvatarURL())
    .addFields(
      { name: 'Version', value: botVersion, inline: true },
      { name: 'Uptime', value: `<t:${startTimestamp}:R>`, inline: true },
      { name: '\u200B', value: '\u200B', inline: false },
      { name: 'Developer', value: staffList, inline: false },
      { name: 'Internal Bot Management', value: staffList, inline: false },
      { name: 'Superusers', value: staffList, inline: false },
      { name: 'Internal Bot Staff', value: staffList, inline: false },
      { name: 'Total Staff Count', value: String(STAFF_IDS.length), inline: false }
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
