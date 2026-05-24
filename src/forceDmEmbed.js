// Org-wide rule: every DM a Community Organisation bot sends MUST be a Discord
// embed, never plain text. Rather than edit dozens of call sites, we patch the
// single chokepoint every DM funnels through — DMChannel.prototype.send (both
// User.send and GuildMember.send route through it). Any plain string/content
// is wrapped into an embed; messages that already carry an embed pass through
// untouched. Imported first in index.js so it's in place before login.
import { DMChannel, EmbedBuilder } from 'discord.js';

const DM_EMBED_COLOUR = 0x5865F2;
const originalSend = DMChannel.prototype.send;

DMChannel.prototype.send = function send(options) {
  let opts = typeof options === 'string' ? { content: options } : { ...(options || {}) };
  const hasEmbeds = Array.isArray(opts.embeds) && opts.embeds.length > 0;
  if (!hasEmbeds) {
    const body = (opts.content != null && String(opts.content).trim() !== '') ? String(opts.content) : '​';
    opts.embeds = [new EmbedBuilder().setColor(DM_EMBED_COLOUR).setDescription(body.slice(0, 4096))];
    delete opts.content;
  }
  return originalSend.call(this, opts);
};
