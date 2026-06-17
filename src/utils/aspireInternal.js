// Thin client for aspire-bot's USGRP-scoped internal API. /network-verify lives
// on this (CO Utilities) bot, but aspire-bot does the actual work — it's in every
// USGRP server with admin perms + Postgres, so it owns roles/nicknames/invites
// and can never touch CO-network servers.
const BASE = process.env.ASPIRE_BOT_INTERNAL_URL || 'http://127.0.0.1:3018';
const TOKEN = process.env.ASPIRE_INTERNAL_TOKEN || '';

async function call(method, path, { query, body, timeoutMs = 30000 } = {}) {
  const url = new URL(path, BASE);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  opt.signal = ac.signal;
  let r;
  try { r = await fetch(url, opt); }
  catch (e) { return { ok: false, status: 0, error: 'aspire_unreachable: ' + (e.name === 'AbortError' ? 'timeout' : e.message) }; }
  finally { clearTimeout(timer); }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, ...(json && typeof json === 'object' ? json : {}) };
}

export const networkVerifyApi = {
  positions: () => call('GET', '/internal/network-verify-positions'),
  seats: (position) => call('GET', '/internal/network-verify-seats', { query: { position } }),
  record: (user_id) => call('GET', '/internal/network-verify-record', { query: { user_id } }),
  // Full verified-network-staff roster: [{ discord_id, display_name, seats[], roles[] }].
  list: () => call('GET', '/internal/network-verification-list'),
  // Every verified staffer from ops.network_verifications: [{ discord_id, position, hub_roles[] }].
  all: () => call('GET', '/internal/network-verify-all'),
  // Remove a member from the network verified list (termination) so the on-join
  // handler won't re-grant their roles.
  remove: (user_id) => call('POST', '/internal/network-verify-remove', { body: { user_id } }),
  preview: (user_id, position, name = '') => call('GET', '/internal/network-verify-preview', { query: { user_id, position, name } }),
  // Touches up to ~19 guilds (roles + nicknames + invites) — give it room.
  apply: (user_id, position, approved_by, seat_no = null, name = null) =>
    call('POST', '/internal/network-verify-apply', { body: { user_id, position, approved_by, seat_no, name }, timeoutMs: 180000 }),
};
