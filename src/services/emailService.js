import Imap from 'imap';
import { simpleParser } from 'mailparser';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

// ─── Portal DB ────────────────────────────────────────────────────────────────

const PORTAL_DB = new Database(process.env.PORTAL_DB_PATH, { readonly: true });

/** Look up a user's CO email by Discord ID. */
export function getUserCoEmail(discordId) {
  const user = PORTAL_DB.prepare('SELECT co_email, email, display_name FROM users WHERE discord_id = ?').get(String(discordId));
  return user?.co_email || user?.email || null;
}

// ─── Google Sheets Config Loader ───────────────────────────────────────────────

const EMAIL_CONFIG_PATH = './src/config/emailConfig.json';
const EMAIL_ACCOUNTS_SHEET = JSON.parse(readFileSync(EMAIL_CONFIG_PATH, 'utf8'));

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetch email accounts from Google Sheet (IMAP credentials only).
 * Cached for CACHE_TTL_MS to avoid hammering the API.
 */
export async function fetchEmailConfig() {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL_MS) return cachedConfig;

  const auth = new GoogleAuth({
    keyFile: '/home/vpcommunityorganisation/clawd/services/onboarding-portal/config/google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: EMAIL_ACCOUNTS_SHEET.spreadsheetId,
    range: `${EMAIL_ACCOUNTS_SHEET.sheetName}!${EMAIL_ACCOUNTS_SHEET.readRange}`,
  });

  const rows = res.data.values || [];
  const config = {};

  // Row 0 is headers; cols: inbox_id, name, emoji, description, smtp_host, smtp_port, smtp_user, smtp_password, imap_host, imap_port, imap_user, imap_password, access_type, allowed_ids_or_role_ids
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const [
      inbox_id, name, emoji, description,
      smtp_host, smtp_port, smtp_user, smtp_password,
      imap_host, imap_port, imap_user, imap_password, access_type, allowed_ids_or_role_ids,
    ] = row;

    if (!inbox_id) continue;

    const allowedList = (allowed_ids_or_role_ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    config[inbox_id] = {
      inbox_id,
      name: name || inbox_id,
      emoji: emoji || '📧',
      description: description || '',
      // IMAP only — SMTP is handled by Brevo
      imap: {
        host: imap_host || '',
        port: parseInt(imap_port) || 993,
        user: imap_user || smtp_user || '',
        password: imap_password || smtp_password || '',
        secure: parseInt(imap_port) === 993,
      },
      folders: {
        inbox: 'INBOX',
        sent: 'Sent',
        archive: 'Archive',
      },
      access: {
        type: access_type || 'role',
        ids: access_type === 'ids' ? allowedList : [],
        roleIds: access_type === 'role' || access_type === 'eob' ? allowedList : [],
      },
    };
  }

  cachedConfig = config;
  cacheTime = now;
  return config;
}

/**
 * Get all inboxes a user can access based on their Discord ID and roles.
 */
export async function getAccessibleInboxes(discordUserId, discordRoleIds = []) {
  const allInboxes = await fetchEmailConfig();
  const accessible = [];

  for (const [id, inbox] of Object.entries(allInboxes)) {
    if (inbox.access.type === 'ids') {
      if (inbox.access.ids.includes(discordUserId)) accessible.push(inbox);
    } else if (inbox.access.type === 'eob') {
      if (id === 'audit_vault') continue;
      accessible.push(inbox);
    } else if (inbox.access.type === 'role') {
      const hasRole = inbox.access.roleIds.some(rid => discordRoleIds.includes(rid));
      if (hasRole) accessible.push(inbox);
    }
  }

  return accessible;
}

// ─── IMAP Connection ───────────────────────────────────────────────────────────

function createImapConnection(inbox) {
  return new Imap({
    user: inbox.imap.user,
    password: inbox.imap.password,
    host: inbox.imap.host,
    port: inbox.imap.port,
    tls: inbox.imap.secure,
    tlsOptions: { rejectUnauthorized: false },
  });
}

/**
 * Fetch inbox emails — newest first, paginated.
 */
export async function fetchInboxEmails(inbox, page = 0, perPage = 10) {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(inbox);

    imap.once('ready', () => {
      imap.openBox(inbox.folders?.inbox || 'INBOX', true, (err, box) => {
        if (err) { imap.end(); return reject(err); }

        const total = box.messages.total;
        if (total === 0) {
          imap.end();
          return resolve({ emails: [], total: 0, page, perPage });
        }

        const start = Math.max(1, total - (page + 1) * perPage + 1);
        const end = Math.min(total, total - page * perPage);

        const fetch = imap.seq.fetch(`${start}:${end}`, {
          bodies: 'HEADER.FIELDS (FROM SUBJECT DATE TO CC)',
          struct: true,
        });

        const emails = [];
        fetch.on('message', (msg) => {
          const email = { headers: {}, uid: null, seqno: null };
          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', chunk => { buffer += chunk.toString('utf8'); });
            stream.once('end', () => {
              email.headers = Imap.parseHeader(buffer);
            });
          });
          msg.once('attributes', (attrs) => {
            email.uid = attrs.uid;
            email.seqno = msg.seqno;
          });
          msg.once('done', () => emails.push(email));
        });

        fetch.once('error', (err) => { imap.end(); reject(err); });
        fetch.once('end', () => {
          emails.sort((a, b) => b.seqno - a.seqno);
          imap.end();
          resolve({ emails, total, page, perPage });
        });
      });
    });

    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

/**
 * Fetch full email body by UID.
 */
export async function fetchEmailBody(inbox, uid) {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(inbox);

    imap.once('ready', () => {
      imap.openBox(inbox.folders?.inbox || 'INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }

        const fetch = imap.fetch(uid, { bodies: '' });
        let rawEmail = '';

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            stream.on('data', chunk => { rawEmail += chunk.toString('utf8'); });
            stream.once('end', async () => {
              try {
                const parsed = await simpleParser(rawEmail);
                resolve({
                  from: parsed.from?.value?.[0] || {},
                  to: parsed.to?.value || [],
                  cc: parsed.cc?.value || [],
                  subject: parsed.subject || '(no subject)',
                  date: parsed.date || new Date(),
                  text: parsed.text || '',
                  html: parsed.html || '',
                  headers: parsed.headers,
                  textAsHtml: markdownToDiscord(parsed.text || ''),
                });
              } catch (e) {
                reject(e);
              }
            });
          });
        });

        fetch.once('error', (err) => { imap.end(); reject(err); });
        fetch.once('end', () => imap.end());
      });
    });

    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

// ─── Brevo Email Sending ───────────────────────────────────────────────────────

const BREVO_API_KEY = process.env.BREVO_API_KEY;

const BREVO_SENDER = {
  name: 'CO Bot',
  email: 'noreply@communityorg.co.uk',
};

/**
 * Send email via Brevo API.
 * @param {object} options - { to, cc, subject, body, inReplyTo, references }
 * @param {string} senderCoEmail - The sender's CO email address (from portal DB)
 */
export async function sendEmailViaBrevo(options, senderCoEmail) {
  const { to, cc, subject, body, inReplyTo, references } = options;

  const payload = {
    sender: {
      name: senderCoEmail.split('@')[0],
      email: BREVO_SENDER.email, // Brevo requires verified sender — relay from noreply@
    },
    to: Array.isArray(to) ? to.map(t => typeof t === 'string' ? { email: t } : t) : [{ email: to }],
    ...(cc ? { cc: Array.isArray(cc) ? cc.map(c => typeof c === 'string' ? { email: c } : c) : [{ email: cc }] } : {}),
    subject,
    htmlContent: `<html><body style="font-family: Arial, sans-serif;"><pre style="white-space: pre-wrap;">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`,
    ...(inReplyTo ? { replyTo: { email: senderCoEmail, name: senderCoEmail.split('@')[0] } } : {}),
    ...(references ? { headers: { references } } : {}),
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Brevo send failed');
  return { messageId: data.messageId };
}

/**
 * Reply to an email — looks up sender's CO email and sends via Brevo.
 */
export async function sendReply(inbox, options, discordUserId) {
  const coEmail = getUserCoEmail(discordUserId);
  if (!coEmail) throw new Error('No CO email found for user in portal');
  return sendEmailViaBrevo(options, coEmail);
}

/**
 * Forward an email — looks up sender's CO email and sends via Brevo.
 */
export async function sendForward(inbox, options, discordUserId) {
  const coEmail = getUserCoEmail(discordUserId);
  if (!coEmail) throw new Error('No CO email found for user in portal');
  return sendEmailViaBrevo(options, coEmail);
}

// ─── Archive (IMAP move) ──────────────────────────────────────────────────────

/**
 * Move an email to the Archive folder.
 */
export async function archiveEmail(inbox, uid) {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(inbox);
    const archiveFolder = inbox.folders?.archive || 'Archive';

    imap.once('ready', () => {
      imap.openBox(inbox.folders?.inbox || 'INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.move(uid, archiveFolder, (moveErr) => {
          imap.end();
          if (moveErr) return reject(moveErr);
          resolve();
        });
      });
    });

    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

// ─── HTML → Discord-safe Markdown ─────────────────────────────────────────────

/**
 * Strip HTML and convert to simple Discord-friendly markdown.
 */
export function markdownToDiscord(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n').replace(/<\/div>/gi, '\n')
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split text into Discord-safe chunks (2000 chars max).
 */
export function paginateText(text, maxLen = 2000) {
  const chunks = [];
  while (text.length > maxLen) {
    chunks.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  if (text) chunks.push(text);
  return chunks;
}
