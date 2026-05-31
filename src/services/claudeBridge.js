// Claude bridge — lets the two founders fix things from Discord.
//
// Reply to a busted embed/message (or just post) with "Claude ..." and this
// spins up a brand-new headless Claude Code session ON THIS SERVER, in the
// services repo, with full tools. It reacts 👀, shows the typing indicator the
// whole time it works, fixes the issue end-to-end (edit → build → restart →
// commit), then swaps to ✅ and replies with a plain-English summary.
//
// Reply to Claude's OWN reply with "Claude ..." again and it RESUMES that same
// session (so a Discord thread = one ongoing Claude conversation with memory).
//
// HARD-GATED to Dion + Evan only. Anything that runs autonomous code execution
// from a chat box has to be locked down — only these two ids can trigger it,
// one run at a time, every run logged.
import { spawn } from 'node:child_process';
import { EmbedBuilder } from 'discord.js';

const FOUNDERS = new Set(['723199054514749450', '415922272956710912']); // Dion, Evan
const REPO = '/home/vpcommunityorganisation/clawd/services';
const CLAUDE = '/home/vpcommunityorganisation/.npm-global/bin/claude';
const TRIGGER = /\bclaude\b/i;
const TIMEOUT_MS = 20 * 60_000;          // a fix can take a while; cap at 20 min
const sessionByReply = new Map();        // Claude reply msg id -> session_id (thread continuation)
let busy = false;

// Flatten a Discord message (content + every embed field) into plain text so
// Claude can see exactly what the broken embed looks like.
function serializeMessage(m) {
  const lines = [];
  if (m.content) lines.push('Content: ' + m.content);
  for (const e of (m.embeds || [])) {
    if (e.title) lines.push('Embed title: ' + e.title);
    if (e.author?.name) lines.push('Embed author: ' + e.author.name);
    if (e.description) lines.push('Embed description: ' + e.description);
    for (const f of (e.fields || [])) lines.push(`Field "${f.name}": ${f.value}`);
    if (e.footer?.text) lines.push('Footer: ' + e.footer.text);
  }
  lines.push('Posted by: ' + (m.author?.username || '?') + (m.author?.bot ? ' (bot)' : ''));
  lines.push('Message link: ' + m.url);
  return lines.join('\n').slice(0, 4000);
}

function buildPrompt({ instruction, replied, channelName, guildName, author }) {
  const parts = [
    `You are Claude Code working on the USGRP / Community Organisation stack at ${REPO} ` +
    `(a git repo; services run under pm2; the citizen portal client needs "npm run build" after client edits). ` +
    `A trusted maintainer (${author}) is asking you to fix something straight from Discord.`,
    `\nTheir request: ${instruction || '(see the message they replied to)'}`,
  ];
  if (replied) {
    parts.push(`\nThey replied to this message${channelName ? ` in #${channelName}` : ''}${guildName ? ` (${guildName})` : ''} — this is what to look at / fix:`);
    parts.push('```\n' + replied + '\n```');
  }
  parts.push(
    `\nDo the whole job end-to-end: find the root cause, edit the code, build the affected client if it's a client change, ` +
    `restart the affected pm2 service, and commit your change to git (stage only the files you changed, clear message). ` +
    `Then STOP and give a concise plain-English summary — a few sentences on what was wrong and what you changed. ` +
    `That summary is posted straight back to Discord, so: no markdown headings, no code fences, keep it tight (under ~1500 chars).`
  );
  return parts.join('\n');
}

function runClaude(prompt, resumeId) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions'];
    if (resumeId) args.push('--resume', resumeId);
    // pm2's env can be thin — make sure HOME (for ~/.claude creds) and PATH
    // (git/npm/pm2/node for Claude's own tools) are present.
    const HOME = process.env.HOME || '/home/vpcommunityorganisation';
    const env = {
      ...process.env,
      HOME,
      PATH: `${process.env.PATH || ''}:${HOME}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
    };
    const child = spawn(CLAUDE, args, { cwd: REPO, env });
    let out = '', err = '';
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } resolve({ is_error: true, error: 'timed out after 20 min' }); }, TIMEOUT_MS);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(killer); resolve({ is_error: true, error: 'spawn failed: ' + e.message }); });
    child.on('close', () => {
      clearTimeout(killer);
      try {
        const j = JSON.parse(out);
        resolve({ is_error: !!j.is_error, result: j.result, session_id: j.session_id, cost: j.total_cost_usd, turns: j.num_turns });
      } catch {
        resolve({ is_error: true, error: (err || out || 'no output from claude').slice(0, 600) });
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function setupClaudeBridge(client) {
  client.on('messageCreate', async (message) => {
    try {
      if (message.author?.bot) return;
      if (!FOUNDERS.has(message.author.id)) return;
      const text = message.content || '';
      if (!TRIGGER.test(text)) return;
      // Only fire when it's clearly addressed: a reply, or starts with "Claude".
      const isReply = !!message.reference?.messageId;
      if (!isReply && !/^\s*claude\b/i.test(text)) return;

      // Gather the replied-to context + decide whether to resume a session.
      let resumeId = null, repliedText = null;
      if (isReply) {
        const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        if (ref) {
          if (sessionByReply.has(ref.id)) resumeId = sessionByReply.get(ref.id); // continue the thread's session
          repliedText = serializeMessage(ref);
        }
      }

      if (busy) {
        await message.react('⏳').catch(() => { });
        await message.reply({ content: "I'm mid-fix on another request — give me a moment and try again.", allowedMentions: { repliedUser: false } }).catch(() => { });
        return;
      }
      busy = true;
      await message.react('👀').catch(() => { });
      message.channel.sendTyping().catch(() => { });
      const typing = setInterval(() => message.channel.sendTyping().catch(() => { }), 8000);

      const instruction = text.replace(/\bclaude\b/ig, '').trim().replace(/^[,:\s]+/, '');
      const prompt = buildPrompt({
        instruction, replied: repliedText,
        channelName: message.channel?.name, guildName: message.guild?.name,
        author: message.author.username,
      });
      console.log(JSON.stringify({ msg: 'claudeBridge run start', user: message.author.username, resume: !!resumeId, instruction: instruction.slice(0, 120) }));

      let out;
      try { out = await runClaude(prompt, resumeId); }
      finally { clearInterval(typing); }

      // Swap the 👀 for a verdict.
      await message.reactions.cache.get('👀')?.users.remove(client.user.id).catch(() => { });
      console.log(JSON.stringify({ msg: 'claudeBridge run done', ok: !out.is_error, session: out.session_id, cost: out.cost }));

      if (out.is_error) {
        await message.react('❌').catch(() => { });
        await message.reply({ content: `❌ Couldn't finish that one — ${(out.error || 'see server logs').slice(0, 800)}`, allowedMentions: { repliedUser: false } }).catch(() => { });
      } else {
        await message.react('✅').catch(() => { });
        const emb = new EmbedBuilder()
          .setColor(0x6c7bff)
          .setAuthor({ name: 'Claude' })
          .setDescription((out.result || '(done — no summary returned)').slice(0, 4000))
          .setFooter({ text: `session ${String(out.session_id || '').slice(0, 8)} · ${out.turns || '?'} turns · $${(out.cost || 0).toFixed(3)} · reply here to continue` })
          .setTimestamp();
        const reply = await message.reply({ embeds: [emb], allowedMentions: { repliedUser: false } }).catch(() => null);
        if (reply && out.session_id) {
          sessionByReply.set(reply.id, out.session_id);
          if (sessionByReply.size > 200) sessionByReply.delete(sessionByReply.keys().next().value); // bound the map
        }
      }
    } catch (e) {
      console.error('[claudeBridge]', e.message);
    } finally {
      busy = false;
    }
  });
  console.log(JSON.stringify({ msg: 'claudeBridge listening (founders only, reply "Claude …" to fix)' }));
}
