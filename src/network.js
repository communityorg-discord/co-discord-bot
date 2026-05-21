// Per-interaction network context for the CO Discord bot.
//
// Every Discord interaction (slash command, button, modal) arrives
// with a guildId. We resolve that to a network object so command
// handlers can branch on which network they're running in. Provides
// guard helpers for commands that should only run in specific
// networks (e.g. USGRP-only RP commands hidden from CO main).
//
// Usage in a command handler:
//   import { interactionNetwork, requireNetwork } from '../network.js';
//   ...
//   const net = interactionNetwork(interaction);
//   if (!requireNetwork(interaction, 'usgrp')) return;

import { networkForGuild, defaultNetwork, networkAllows } from './config.js';

// Resolve the network for an incoming interaction. Falls back to the
// default network if the guild isn't recognised (e.g. a stray DM
// interaction or a guild the bot was just added to).
export function interactionNetwork(interaction) {
    const guildId = interaction?.guildId || interaction?.guild?.id;
    return networkForGuild(guildId) || defaultNetwork();
}

// Guard for network-scoped commands. Replies with a friendly
// "this command isn't available here" message and returns false so
// the caller can bail. Returns true when the interaction is in one
// of the allowed networks.
//
// `allowed` is either a single network id ('co' | 'usgrp') or an
// array of ids.
export async function requireNetwork(interaction, allowed) {
    const net = interactionNetwork(interaction);
    const allowedArr = Array.isArray(allowed) ? allowed : [allowed];
    if (allowedArr.includes(net.id)) return true;
    try {
        const allowedNames = allowedArr
            .map(id => `**${id.toUpperCase()}**`)
            .join(' or ');
        await interaction.reply({
            content: `This command is only available in ${allowedNames} servers.`,
            ephemeral: true,
        });
    } catch (_) { /* interaction may already be replied to */ }
    return false;
}

// Guard for command-set availability. Different networks have
// different command surfaces (CO has staff/mod/audit; USGRP also
// has rp/gov/banking/civic). This lets a single command file declare
// "I'm a banking command" and have it auto-hidden in CO.
export async function requireCommandSet(interaction, commandSet) {
    const net = interactionNetwork(interaction);
    if (networkAllows(net, commandSet)) return true;
    try {
        await interaction.reply({
            content: `The **${commandSet}** command set is not enabled in ${net.short}.`,
            ephemeral: true,
        });
    } catch (_) { /* swallow */ }
    return false;
}

// Tag a log line with the network so multi-network log streams stay
// readable. Returns a `[CO]` / `[USGRP]` prefix.
export function netTag(net) {
    if (!net) return '[??]';
    return `[${net.short}]`;
}
