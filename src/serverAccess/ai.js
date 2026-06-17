// DeepSeek-backed natural-language parser for /access. Turns a staffer's plain
// message ("I need an invite to the Treasury for a few days", "I need an
// extension", "what am I in?") into a structured intent the command executes.
const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function chat(system, user, max_tokens = 400) {
    if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured');
    const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
            model: MODEL,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            max_tokens, temperature: 0.1,
        }),
    });
    if (!r.ok) throw new Error(`deepseek ${r.status}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || '{}';
}

// requestServers: [{ key, name }] the member may request.
// activeTimed: [{ key, name }] grants they currently hold on a timer (for extend).
// Returns { action, server_key, duration_days, no_limit, reason, message }.
export async function parseAccessIntent(text, { requestServers = [], activeTimed = [] } = {}) {
    const sys = `You route a USGRP network staff member's plain-English message into ONE access action. Respond with a JSON object only.

Servers they may REQUEST an invite to (key — name):
${requestServers.map(s => `  ${s.key} — ${s.name}`).join('\n') || '  (none)'}

Servers they currently hold on a TIME LIMIT (can be extended):
${activeTimed.map(s => `  ${s.key} — ${s.name}`).join('\n') || '  (none)'}

Return JSON with these fields:
  "action": one of "invite" | "extend" | "status" | "unknown"
  "server_key": the matching key from the lists above, or null. Match loosely (e.g. "treasury", "the treasury dept" → treasury). If they don't name one and there's exactly one relevant server, use it; otherwise null.
  "duration_days": integer number of days requested, or null if none/"no limit"/"permanent"/"just want to stay"
  "no_limit": true if they explicitly want NO time limit (stay indefinitely), else false
  "reason": their stated reason for needing access, as a short phrase, or null
  "message": a one-sentence friendly confirmation back to them of what you understood

Rules:
- "invite to X" / "join X" / "access to X" → action "invite".
- "extension" / "more time" / "extend" / "keep my access" → action "extend".
- "what am I in" / "my access" / "status" → action "status".
- If the named server isn't in the lists, action "invite" with server_key null (they're not eligible — the bot will tell them).
- Never invent a server_key that isn't listed.`;
    let out;
    try { out = JSON.parse(await chat(sys, text)); } catch { return { action: 'unknown' }; }
    const action = ['invite', 'extend', 'status'].includes(out.action) ? out.action : 'unknown';
    let duration_days = Number.isFinite(out.duration_days) ? Math.max(0, Math.round(out.duration_days)) : null;
    if (duration_days === 0) duration_days = null;
    return {
        action,
        server_key: out.server_key || null,
        duration_days,
        no_limit: !!out.no_limit,
        reason: out.reason ? String(out.reason).slice(0, 300) : null,
        message: out.message ? String(out.message).slice(0, 300) : null,
    };
}

// Admin instruction about ANOTHER member: send them an invite, or terminate.
// targetServers: [{ key, name }] the target may be invited to.
export async function parseAdminIntent(text, { targetServers = [] } = {}) {
    const sys = `You route a USGRP Network Administrator's instruction about ANOTHER staff member into ONE action. Respond with a JSON object only.

Servers the target member can be invited to (key — name):
${targetServers.map(s => `  ${s.key} — ${s.name}`).join('\n') || '  (none)'}

Return JSON:
  "action": one of "send" | "terminate" | "unknown"
  "server_key": the matching key from the list, or null (only for "send"). Match loosely.
  "duration_days": integer days for the invite, or null for no limit
  "no_limit": true if they want no time limit
  "reason": the stated reason (needed for both actions), or null
  "message": a one-sentence confirmation of what you understood

Rules:
- "invite / send / give them access to X" → "send".
- "terminate / remove from the network / kick them out / fire" → "terminate".
- Never invent a server_key that isn't listed.`;
    let out;
    try { out = JSON.parse(await chat(sys, text)); } catch { return { action: 'unknown' }; }
    const action = ['send', 'terminate'].includes(out.action) ? out.action : 'unknown';
    let duration_days = Number.isFinite(out.duration_days) ? Math.max(0, Math.round(out.duration_days)) : null;
    if (duration_days === 0) duration_days = null;
    return {
        action,
        server_key: out.server_key || null,
        duration_days,
        no_limit: !!out.no_limit,
        reason: out.reason ? String(out.reason).slice(0, 300) : null,
        message: out.message ? String(out.message).slice(0, 300) : null,
    };
}

export const aiAvailable = () => !!API_KEY;
