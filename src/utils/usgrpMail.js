// Thin client for the USGRP mail provisioning API (usgrp-mail service).
// Used to create a mailbox when a network staff member is verified, and to
// disable it when they're terminated.
const MAIL_API = process.env.USGRP_MAIL_API || 'http://127.0.0.1:3028';
const TOKEN = process.env.ASPIRE_INTERNAL_TOKEN || '';

async function call(path, body) {
  const r = await fetch(`${MAIL_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `mail_api_${r.status}`);
  return j;
}

// Create (or re-issue) a mailbox. Returns { address, password, imap, smtp, webmail }.
export const createMailbox  = (discord_id, display_name) => call('/accounts', { discord_id, display_name });
// Disable login (keeps the mailbox). Looks up the address by discord_id.
export const disableMailbox = (discord_id) => call('/accounts/disable', { discord_id });
