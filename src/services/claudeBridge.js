// Claude bridge — lets the two founders fix things from Discord.
//
// Reply to a busted embed/message (or post a message starting with it) with
// "Claude …" and this hands the job to a DETACHED runner (claudeRun.mjs) that
// runs a fresh headless Claude Code session on the server and posts back to
// Discord itself over REST. Because the runner is detached, a fix that restarts
// the bots can't kill it — it still streams progress and replies.
//
// This listener is intentionally tiny: gather context, spawn the runner, done.
// All the Discord I/O, locks (per-message + global), streaming and session
// resume live in claudeRun.mjs so BOTH bots can share one runner.
//
// HARD-GATED to Dion + Evan. The runner dedups if both bots fire on one message.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FOUNDERS = new Set(['723199054514749450', '415922272956710912']); // Dion, Evan
const TRIGGER = /\bclaude\b/i;
const HOME = process.env.HOME || '/home/vpcommunityorganisation';
const RUNNER = '/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/services/claudeRun.mjs';
const SESS_FILE = `${HOME}/.cache/claude-bridge/sessions.json`;

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
    `You are Claude Code working on the USGRP / Community Organisation stack at /home/vpcommunityorganisation/clawd/services ` +
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
    `It's safe to restart co-discord-bot or aspire-bot — you run in a detached process that survives it. ` +
    `Then STOP and give a concise plain-English summary — a few sentences on what was wrong and what you changed. ` +
    `It's posted straight to Discord, so no markdown headings, no code fences, keep it under ~1500 chars.`
  );
  return parts.join('\n');
}

export function setupClaudeBridge(client) {
  client.on('messageCreate', async (message) => {
    try {
      if (message.author?.bot) return;
      if (!FOUNDERS.has(message.author.id)) return;
      const text = message.content || '';
      if (!TRIGGER.test(text)) return;
      const isReply = !!message.reference?.messageId;
      if (!isReply && !/^\s*claude\b/i.test(text)) return;

      let resume = null, repliedText = null;
      if (isReply) {
        const refId = message.reference.messageId;
        try { const map = JSON.parse(readFileSync(SESS_FILE, 'utf8')); if (map[refId]) resume = map[refId]; } catch { }
        const ref = await message.channel.messages.fetch(refId).catch(() => null);
        if (ref) repliedText = serializeMessage(ref);
      }

      const instruction = text.replace(/\bclaude\b/ig, '').trim().replace(/^[,:\s]+/, '');
      const prompt = buildPrompt({ instruction, replied: repliedText, channelName: message.channel?.name, guildName: message.guild?.name, author: message.author.username });
      const env = { ...process.env, CR_CHANNEL: message.channel.id, CR_MSG: message.id, CR_PROMPT_B64: Buffer.from(prompt).toString('base64') };
      if (resume) env.CR_RESUME = resume;

      const child = spawn('node', [RUNNER], { detached: true, stdio: 'ignore', env });
      child.unref();  // fully detach — survives a bot restart
      console.log(JSON.stringify({ msg: 'claudeBridge dispatched', user: message.author.username, resume: !!resume, instruction: instruction.slice(0, 120) }));
    } catch (e) {
      console.error('[claudeBridge]', e.message);
    }
  });
  console.log(JSON.stringify({ msg: 'claudeBridge listening (founders only, reply "Claude …" to fix)' }));
}
