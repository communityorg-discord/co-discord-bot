import Imap from 'imap';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

// ─── Google Sheets Config Loader ─────────────────────────────────────────────

const EMAIL_CONFIG_PATH = './src/config/emailConfig.json';
const EMAIL_ACCOUNTS_SHEET = JSON.parse(readFileSync(EMAIL_CONFIG_PATH, 'utf8'));

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetch email accounts from Google Sheet.
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

  // Row 0 is headers: inbox_id, name, emoji, description, smtp_host, smtp_port, smtp_user, smtp_password, imap_host, imap_port, access_type, allowed_ids_or_role_ids
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const [
      inbox_id, name, emoji, description,
      smtp_host, smtp_port, smtp_user, smtp_password,
      imap_host, imap_port, access_type, allowed_ids_or_role_ids,
    ] = row;

    if (!inbox_id) continue;

    // Parse allowed IDs — comma-separated in one cell
    const allowedList = (allowed_ids_or_role_ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    config[inbox_id] = {
      inbox_id,
      name: name || inbox_id,
      emoji: emoji || '📧',
      description: description || '',
      smtp: {
        host: smtp_host || '',
        port: parseInt(smtp_port) || 587,
        user: smtp_user || '',
        password: smtp_password || '',
        secure: parseInt(smtp_port) === 465,
      },
      imap: {
        host: imap_host || '',
        port: parseInt(imap_port) || 993,
        user: imap_user || '',
        password: imap_password || '',
        secure: parseInt(imap_port) === 993,
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
      // Audit Vault — only the 3 hardcoded IDs
      if (inbox.access.ids.includes(discordUserId)) {
        accessible.push(inbox);
      }
    } else if (inbox.access.type === 'eob') {
      // EOB global viewer — blocked from audit_vault, sees all others
      if (id === 'audit_vault') continue;
      // EOB sees all role-based inboxes
      accessible.push(inbox);
    } else if (inbox.access.type === 'role') {
      // Team inbox — user must have one of the allowed roles
      const hasRole = inbox.access.roleIds.some(rid => discordRoleIds.includes(rid));
      if (hasRole) accessible.push(inbox);
    }
  }

  return accessible;
}

// ─── IMAP Connection ──────────────────────────────────────────────────────────

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
 * Fetch inbox emails. Returns array of email summaries (newest first).
 */
export async function fetchInboxEmails(inbox, page = 0, perPage = 10) {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(inbox);
    const emails = [];

    imap.once('ready', () => {
      imap.openBox(inbox.folders?.inbox || 'INBOX', true, (err, box) => {
        if (err) { imap.end(); return reject(err); }

        const start = Math.max(0, box.messages.total - (page + 1) * perPage);
        const end = box.messages.total - page * perPage;

        if (box.messages.total === 0) {
          imap.end();
          return resolve({ emails: [], total: 0, page, perPage });
        }

        const fetch = imap.seq.fetch(`${start + 1}:${end}`, {
          bodies: 'HEADER.FIELDS (FROM SUBJECT DATE TO CC)',
          struct: true,
        });

        fetch.on('message', (msg) => {
          const email = { headers: {}, body: '', uid: null, seqno: null };
          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', chunk => { buffer += chunk.toString('utf8'); });
            stream.once('end', () => {
              const parsed = Imap.parseHeader(buffer);
              email.headers = parsed;
            });
          });
          msg.once('attributes', (attrs) => {
            email.uid = attrs.uid;
            email.seqno = info.seqno;
            email.flags = attrs.flags;
          });
          msg.once('done', () => emails.push(email));
        });

        fetch.once('error', (err) => { imap.end(); reject(err); });
        fetch.once('end', () => {
          // Sort newest first (seqno descending)
          emails.sort((a, b) => b.seqno - a.seqno);
          imap.end();
          resolve({ emails, total: box.messages.total, page, perPage });
        });
      });
    });

    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

/**
 * Fetch a single email body by UID.
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

// ─── SMTP ─────────────────────────────────────────────────────────────────────

function createSmtpTransport(inbox) {
  return nodemailer.createTransport({
    host: inbox.smtp.host,
    port: inbox.smtp.port,
    secure: inbox.smtp.secure,
    auth: { user: inbox.smtp.user, pass: inbox.smtp.password },
    tls: { rejectUnauthorized: false },
  });
}

/**
 * Send an email reply or forward.
 */
export async function sendEmail(inbox, options) {
  const { to, cc, subject, body, inReplyTo, references } = options;
  const transport = createSmtpTransport(inbox);

  const info = await transport.sendMail({
    from: inbox.smtp.user,
    to,
    cc,
    subject,
    text: body,
    ...(inReplyTo ? { inReplyTo, references } : {}),
  });

  return { messageId: info.messageId };
}

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
 * Strip HTML tags and convert to simple Discord-friendly markdown.
 * Handles code blocks, bold, italic, links, and line breaks.
 */
export function markdownToDiscord(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
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
 * Split text into chunks safe for Discord (2000 chars max).
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
