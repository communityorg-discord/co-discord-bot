/**
 * Resolve a string user argument (mention like <@123> or raw ID like "123") to a Discord user object.
 * Returns { id, user } where user is a Discord User, or null if resolution fails.
 * @param {string} userArg - The string from the command option
 * @param {import('discord.js').Guild} guild - The guild to fetch the member from
 */
export async function resolveUser(userArg, guild) {
  if (!userArg) return null;
  const trimmed = userArg.trim();

  // Extract ID from mention format <@123> or <@!123>
  let userId = trimmed;
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    userId = mentionMatch[1];
  }

  // Validate it's numeric
  if (!/^\d+$/.test(userId)) return null;

  try {
    const user = await guild.client.users.fetch(userId);
    return { id: userId, user };
  } catch {
    return null;
  }
}
