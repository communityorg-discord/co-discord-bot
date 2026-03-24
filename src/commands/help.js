import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const COMMAND_DATA = {
  verify: {
    name: 'verify',
    description: 'Submit a staff verification request (staff only).',
    category: 'Staff',
    usage: '/verify',
    example: '/verify',
    details: 'Submits your staff verification request to the #verification-requests channel. Requires your Discord account to be linked to your CO portal account.',
  },
  'authorisation-override': {
    name: 'authorisation-override',
    description: 'Override a staff member\'s authorisation level across all servers.',
    category: 'Superuser',
    usage: '/authorisation-override <user> <level> [reason]',
    example: '/authorisation-override @JohnDoe 5 Promoted to Director',
    details: 'Replaces the target user\'s current Authorisation Level role with the specified level (1–7) across all CO servers. Does not affect their position role. Requires superuser.',
  },
  unverify: {
    name: 'unverify',
    description: 'Revoke a verified staff member\'s access.',
    category: 'Superuser',
    usage: '/unverify <user>',
    example: '/unverify @JohnDoe',
    details: 'Removes the Verified and CO Staff roles from the user across all servers and marks their verification entry as revoked. Requires superuser.',
  },
  strike: {
    name: 'strike',
    description: 'Issue a formal strike/warning to a staff member.',
    category: 'Moderation',
    usage: '/strike <user> <type> [reason]',
    example: '/strike @JohnDoe Verbal misconduct Persistent lateness',
    details: 'Issues a strike to the target user and logs it to the portal. Types: verbal, written, final. Creates a portal case. Requires staff role.',
  },
  infractions: {
    name: 'infractions',
    description: 'View a staff member\'s infraction history.',
    category: 'Moderation',
    usage: '/infractions [user]',
    example: '/infractions @JohnDoe',
    details: 'Shows all strikes and infractions for the specified user or yourself. Includes case reference, type, date, and status.',
  },
  suspend: {
    name: 'suspend',
    description: 'Suspend a staff member\'s access temporarily.',
    category: 'Moderation',
    usage: '/suspend <user> <reason>',
    example: '/suspend @JohnDoe Under investigation',
    details: 'Removes Verified and CO Staff roles from the user across all servers. Does not delete their verification record. Requires superuser.',
  },
  unsuspend: {
    name: 'unsuspend',
    description: 'Restore a suspended staff member\'s access.',
    category: 'Moderation',
    usage: '/unsuspend <user>',
    example: '/unsuspend @JohnDoe',
    details: 'Re-applies Verified and CO Staff roles to the user across all servers. Requires superuser.',
  },
  ban: {
    name: 'ban',
    description: 'Permanently ban a user from all CO servers.',
    category: 'Moderation',
    usage: '/ban <user> [reason]',
    example: '/ban @JohnDoe Policy violation',
    details: 'Bans the user from all CO servers and logs the ban. Requires superuser and staff role.',
  },
  unban: {
    name: 'unban',
    description: 'Lift a ban on a user.',
    category: 'Moderation',
    usage: '/unban <user_id> [reason]',
    example: '/unban 723199054514749450 Lifted after appeal',
    details: 'Removes the user\'s ban from all CO servers. Requires superuser and staff role.',
  },
  terminate: {
    name: 'terminate',
    description: 'Terminate a staff member\'s employment.',
    category: 'HR',
    usage: '/terminate <user> <reason>',
    example: '/terminate @JohnDoe Gross misconduct',
    details: 'Removes all roles, revokes access, and marks the staff member as terminated in the portal. Requires superuser.',
  },
  investigate: {
    name: 'investigate',
    description: 'Open a formal investigation case for a staff member.',
    category: 'HR',
    usage: '/investigate <user> <description>',
    example: '/investigate @JohnDoe Alleged policy breach during offboarding',
    details: 'Opens an investigation case in the portal and notifies the Investigating Officer. Requires staff role.',
  },
  cases: {
    name: 'cases',
    description: 'View and manage open HR/investigation cases.',
    category: 'HR',
    usage: '/cases [case_id]',
    example: '/cases 42',
    details: 'Lists all open cases, or views a specific case by ID. Requires staff role.',
  },
  staff: {
    name: 'staff',
    description: 'Look up a staff member by name or employee number.',
    category: 'Utility',
    usage: '/staff <query>',
    example: '/staff John Doe',
    details: 'Searches the CO staff directory by name or employee number. Shows position, department, supervisor, and employment status.',
  },
  nid: {
    name: 'nid',
    description: 'Submit a Non-Investigational Disciplinary action.',
    category: 'HR',
    usage: '/nid <user> <action_type>',
    example: '/nid @JohnDoe formal_warning',
    details: 'Submits an NID to the portal for the target user. Action types: informal_coaching, formal_verbal_warning, formal_written_warning, final_written_warning, demotion, suspension. Requires staff role.',
  },
  brag: {
    name: 'brag',
    description: 'Log a BRAG performance rating for a staff member.',
    category: 'HR',
    usage: '/brag <user> <rating> [notes]',
    example: '/brag @JohnDoe 5 Exceeded all targets this quarter',
    details: 'Logs a BRAG rating (1–5) for the staff member. Rating descriptions: 1=Needs Improvement, 2=Developing, 3=Meets Expectations, 4=Exceeds, 5=Outstanding. Requires staff role.',
  },
  'dm-exempt': {
    name: 'dm-exempt',
    description: 'Manage DM exemption list for a user.',
    category: 'Moderation',
    usage: '/dm-exempt <add|remove|list> [user]',
    example: '/dm-exempt add @JohnDoe',
    details: 'Add or remove a user from the DM exemption list. Exempted users can receive DMs from staff without bot filtering. Requires superuser.',
  },
  purge: {
    name: 'purge',
    description: 'Delete a number of messages from a channel.',
    category: 'Moderation',
    usage: '/purge <count> [reason]',
    example: '/purge 50 Spam cleanup',
    details: 'Deletes the specified number of messages from the current channel. Bot messages are included. Requires superuser and staff role.',
  },
  scribe: {
    name: 'scribe',
    description: 'Search message history in the current channel.',
    category: 'Utility',
    usage: '/scribe <query> [limit]',
    example: '/scribe "policy update" 20',
    details: 'Searches the last N messages (default 10) in the current channel for the query string. Shows message content, author, and timestamp.',
  },
  leave: {
    name: 'leave',
    description: 'Request to leave a CO server you no longer need access to.',
    category: 'Staff',
    usage: '/leave',
    example: '/leave',
    details: 'Sends a request to leave the current server. A superuser must approve the request.',
  },
  user: {
    name: 'user',
    description: 'View full details about a Discord user.',
    category: 'Utility',
    usage: '/user [user]',
    example: '/user @JohnDoe',
    details: 'Shows Discord user information including join dates, account age, and any CO verification status.',
  },
  'bot-info': {
    name: 'bot-info',
    description: 'Show information about the CO bot.',
    category: 'Utility',
    usage: '/bot-info',
    example: '/bot-info',
    details: 'Displays bot version, uptime, server count, and links to documentation.',
  },
  'gban': {
    name: 'gban',
    description: 'Globally ban a user from all CO servers (emergency).',
    category: 'Moderation',
    usage: '/gban <user_id> <reason>',
    example: '/gban 723199054514749450 Emergency — suspected compromised account',
    details: 'Immediately bans the user from all CO servers without per-server confirmation. Use for emergencies only. Requires superuser + Staff role.',
  },
  'gunban': {
    name: 'gunban',
    description: 'Globally unban a user from all CO servers.',
    category: 'Moderation',
    usage: '/gunban <user_id> [reason]',
    example: '/gunban 723199054514749450 Appeal successful',
    details: 'Removes the user\'s global ban from all CO servers. Requires superuser + Staff role.',
  },
  help: {
    name: 'help',
    description: 'Show help for all commands or a specific command.',
    category: 'Utility',
    usage: '/help [command]',
    example: '/help verify\n/help authorisation-override',
    details: 'Without arguments, lists all available commands. With a command name, shows detailed usage, examples, and description for that command.',
  },
};

const CATEGORIES = [
  { name: 'Superuser', emoji: '🔐', description: 'Requires superuser permissions' },
  { name: 'Moderation', emoji: '🛡️', description: 'Moderation and access control' },
  { name: 'HR', emoji: '📋', description: 'HR and case management' },
  { name: 'Staff', emoji: '👤', description: 'Staff-only commands' },
  { name: 'Utility', emoji: '🔧', description: 'General utility commands' },
];

export default [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help for all commands or a specific command.')
    .addStringOption(opt =>
      opt.setName('command')
        .setDescription('The command to get help for (e.g. verify, strike)')
        .setRequired(false)
    ),
].map(cmd => ({ data: cmd, execute: async (interaction) => {
  const commandName = interaction.options.getString('command');

  if (commandName) {
    const cmd = COMMAND_DATA[commandName.toLowerCase()];
    if (!cmd) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Unknown Command')
          .setDescription(`No command named \`${commandName}\`.\n\nUse \`/help\` to see all available commands.`)
          .setColor(0xef4444)
        ],
        ephemeral: true,
      });
    }

    const category = CATEGORIES.find(c => c.name === cmd.category);

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`${category?.emoji || '📝'} /${cmd.name}`)
        .setDescription(cmd.details)
        .setColor(0x5865F2)
        .addFields(
          { name: 'Category', value: `${category?.emoji} ${cmd.category}`, inline: true },
          { name: 'Usage', value: `\`${cmd.usage}\``, inline: false },
          { name: 'Example', value: cmd.example, inline: false },
        )
        .setFooter({ text: 'CO Staff Assistant' })
        .setTimestamp()
      ],
      ephemeral: true,
    });
  }

  // No command specified — show all commands by category
  const embed = new EmbedBuilder()
    .setTitle('📚 CO Bot Command Reference')
    .setDescription('Use `/help <command>` for detailed information about a specific command.')
    .setColor(0x5865F2)
    .setFooter({ text: 'CO Staff Assistant' })
    .setTimestamp();

  for (const cat of CATEGORIES) {
    const cmds = Object.values(COMMAND_DATA).filter(c => c.category === cat.name);
    if (cmds.length === 0) continue;

    const fieldValue = cmds.map(c => `\`/${c.name}\` — ${c.description}`).join('\n');
    embed.addFields({
      name: `${cat.emoji} ${cat.name}`,
      value: fieldValue,
      inline: false,
    });
  }

  return interaction.reply({ embeds: [embed], ephemeral: true });
} }));
