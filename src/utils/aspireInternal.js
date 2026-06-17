// Thin client for aspire-bot's USGRP-scoped internal API. /network-verify lives
// on this (CO Utilities) bot, but aspire-bot does the actual work — it's in every
// USGRP server with admin perms + Postgres, so it owns roles/nicknames/invites
// and can never touch CO-network servers.
const BASE = process.env.ASPIRE_BOT_INTERNAL_URL || 'http://127.0.0.1:3018';
const TOKEN = process.env.ASPIRE_INTERNAL_TOKEN || '';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function call(method, path, { query, body, timeoutMs = 30000, retries = 3 } = {}) {
  const url = new URL(path, BASE);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const opt = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);

  // aspire-bot does the real work and is occasionally briefly unavailable (e.g. a
  // restart), which surfaced as "aspire_unreachable: fetch failed" and aborted the
  // whole verification. A pre-connection failure (ECONNREFUSED) is safe to retry —
  // no work has started on aspire-bot's side — so back off and try again a few
  // times. A TIMEOUT is NOT retried: the request may already be running there (the
  // apply touches ~19 guilds), and re-firing it could double-apply.
  let lastErr = 'fetch failed';
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    opt.signal = ac.signal;
    let r;
    try {
      r = await fetch(url, opt);
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') return { ok: false, status: 0, error: 'aspire_unreachable: timeout' };
      lastErr = e.message;
      if (attempt < retries) { await sleep(1500 * attempt); continue; }
      return { ok: false, status: 0, error: 'aspire_unreachable: ' + lastErr };
    }
    clearTimeout(timer);
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...(json && typeof json === 'object' ? json : {}) };
  }
  return { ok: false, status: 0, error: 'aspire_unreachable: ' + lastErr };
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
