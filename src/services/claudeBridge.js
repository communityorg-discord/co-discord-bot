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
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const FOUNDERS = new Set(['723199054514749450', '415922272956710912']); // Dion, Evan
const TRIGGER = /\bclaude\b/i;
const HOME = process.env.HOME || '/home/vpcommunityorganisation';
const RUNNER = '/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/services/claudeRun.mjs';
const SESS_FILE = `${HOME}/.cache/claude-bridge/sessions.json`;
const ATTACH_DIR = `${HOME}/.cache/claude-bridge/attachments`;

// Screenshots the founder sends ride in as message ATTACHMENTS, which never made
// it into the prompt before (so "can you see this?" was a flat no). Download any
// image attachments to a local dir and hand the runner the file paths — the
// headless Claude session can Read image files, so it can actually see them.
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGES = 6;
const MAX_BYTES = 12 * 1024 * 1024; // 12MB/image cap

async function saveImageAttachments(m) {
  const out = [];
  const atts = [...(m.attachments?.values?.() || [])];
  for (const a of atts) {
    if (out.length >= MAX_IMAGES) break;
    const isImg = (a.contentType && a.contentType.startsWith('image/')) || IMG_RE.test(a.name || a.url || '');
    if (!isImg) continue;
    if (a.size && a.size > MAX_BYTES) continue;
    try {
      const res = await fetch(a.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) continue;
      const ext = (IMG_RE.exec(a.name || a.url || '')?.[1] || (a.contentType || '').split('/')[1] || 'png').toLowerCase();
      const dir = `${ATTACH_DIR}/${m.id}`;
      mkdirSync(dir, { recursive: true });
      const p = `${dir}/${out.length + 1}.${ext}`;
      writeFileSync(p, buf);
      out.push(p);
    } catch { /* skip a bad attachment, keep the rest */ }
  }
  return out;
}

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

function buildPrompt({ instruction, replied, channelName, guildName, author, images }) {
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
  if (images && images.length) {
    parts.push(
      `\nThey attached ${images.length} image${images.length > 1 ? 's' : ''} (e.g. a screenshot) — you CAN see ${images.length > 1 ? 'them' : 'it'}: ` +
      `use the Read tool on ${images.length > 1 ? 'each of these paths' : 'this path'} to view the actual image, then act on what it shows:`
    );
    for (const p of images) parts.push(`- ${p}`);
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
      const images = [];
      // Images can ride on the trigger message itself ("Claude look at this" +
      // screenshot) OR on the message they replied to. Grab both.
      try { images.push(...await saveImageAttachments(message)); } catch { }
      if (isReply) {
        const refId = message.reference.messageId;
        try { const map = JSON.parse(readFileSync(SESS_FILE, 'utf8')); if (map[refId]) resume = map[refId]; } catch { }
        const ref = await message.channel.messages.fetch(refId).catch(() => null);
        if (ref) {
          repliedText = serializeMessage(ref);
          try { images.push(...await saveImageAttachments(ref)); } catch { }
        }
      }

      const instruction = text.replace(/\bclaude\b/ig, '').trim().replace(/^[,:\s]+/, '');
      const prompt = buildPrompt({ instruction, replied: repliedText, channelName: message.channel?.name, guildName: message.guild?.name, author: message.author.username, images });
      const env = { ...process.env, CR_CHANNEL: message.channel.id, CR_MSG: message.id, CR_PROMPT_B64: Buffer.from(prompt).toString('base64') };
      if (resume) env.CR_RESUME = resume;

      // setsid → the runner becomes a new session leader and is reparented to
      // init immediately, so pm2's tree-kill on a bot restart can't reach it.
      // (Plain detached:true wasn't enough — the runner was still a child at
      // kill time and got taken down with the bot.)
      const child = spawn('setsid', ['node', RUNNER], { detached: true, stdio: 'ignore', env });
      child.unref();
      console.log(JSON.stringify({ msg: 'claudeBridge dispatched', user: message.author.username, resume: !!resume, instruction: instruction.slice(0, 120) }));
    } catch (e) {
      console.error('[claudeBridge]', e.message);
    }
  });
  console.log(JSON.stringify({ msg: 'claudeBridge listening (founders only, reply "Claude …" to fix)' }));
}
