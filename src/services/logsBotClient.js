// Forward an admin log to the central USGRP | Logs bot, so all the founders' alert
// DMs come from one place and THIS bot's DMs stay real, actionable notifications.
// Returns true only if the Logs bot actually delivered — callers fall back to a
// direct local DM when it returns false (e.g. before the Logs bot is invited).
const LOGS_URL = process.env.LOGS_BOT_URL || 'http://127.0.0.1:3029/log';
const LOGS_TOKEN = process.env.LOGS_INTERNAL_TOKEN || '';

export async function emitToLogsBot({ kind = 'admin-dm', user_ids, channel_id, embed, embeds, content } = {}) {
  if (!LOGS_TOKEN) return false;
  try {
    const ser = (e) => (e && typeof e.toJSON === 'function') ? e.toJSON() : e;
    const body = { kind, user_ids, channel_id, content };
    if (Array.isArray(embeds)) body.embeds = embeds.map(ser);
    else if (embed) body.embed = ser(embed);
    const r = await fetch(LOGS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOGS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return j.ok !== false && (j.sent === undefined || j.sent > 0);
  } catch { return false; }
}
