import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fetchEmailConfig, fetchInboxEmails } from './emailService.js';
import { getInboxChannelId, markEmailSeen, isEmailSeen, getSeenEmail, getRepliesForEmail } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

function generateReplyCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Dedupe noisy poller errors. The poller runs every 60s; if the upstream
// (Google Sheets config fetch, IMAP host) fails for hours, we don't want
// 60 lines/hour of identical "Fatal error: ..." in the bot's error log.
// Log on first occurrence, then once per 30min, then again immediately
// when the error message changes or when we recover.
const errorState = { last: new Map(), interval: 30 * 60 * 1000 };
function logDedupedError(scope, message) {
  const now = Date.now();
  const prev = errorState.last.get(scope);
  if (!prev || prev.message !== message || (now - prev.firstAt) >= errorState.interval) {
    const suppressed = prev && prev.message === message ? ` (suppressed ${prev.count}× over the last ${Math.round((now - prev.firstAt) / 60000)}min)` : '';
    console.error(`[${scope}]`, message + suppressed);
    errorState.last.set(scope, { message, firstAt: now, count: 1 });
  } else {
    prev.count++;
  }
}
function clearDedupedError(scope) {
  const prev = errorState.last.get(scope);
  if (prev) {
    if (prev.count > 1) console.log(`[${scope}] recovered (had suppressed ${prev.count - 1}× of: ${prev.message})`);
    errorState.last.delete(scope);
  }
}

// Exponential backoff state for the team inbox poller. If the upstream
// keeps failing (e.g. Google Sheets API permission issue), increase the
// gap between attempts so we don't burn quota / log noise. Resets on
// the first successful poll.
const backoff = { fails: 0, nextAt: 0 };
function backoffShouldSkip() {
  return Date.now() < backoff.nextAt;
}
function backoffOnFailure() {
  backoff.fails++;
  // Steps: 1=60s, 2=60s, 3=5min, 5=30min, 10=2h, capped
  const delays = [60_000, 60_000, 5 * 60_000, 5 * 60_000, 30 * 60_000, 30 * 60_000, 30 * 60_000, 30 * 60_000, 30 * 60_000, 2 * 3600_000];
  const delay = delays[Math.min(backoff.fails - 1, delays.length - 1)];
  backoff.nextAt = Date.now() + delay;
}
function backoffOnSuccess() {
  if (backoff.fails > 0) {
    console.log(`[Email Poller] Recovered after ${backoff.fails} failures — resetting backoff`);
  }
  backoff.fails = 0;
  backoff.nextAt = 0;
}

function buildEmailNotifEmbed(inbox, email, replies = []) {
  const from = email.headers?.from?.[0] || 'Unknown';
  const subject = email.headers?.subject?.[0] || '(no subject)';
  const date = email.headers?.date?.[0] ? `<t:${Math.floor(new Date(email.headers.date[0]).getTime() / 1000)}:R>` : '';
  const to = email.headers?.to?.[0] || '';

  const embed = new EmbedBuilder()
    .setTitle(subject.slice(0, 240))
    .setColor(replies.length > 0 ? 0x22C55E : 0x1a73e8)
    .setDescription(`${E.dm} **${subject.slice(0, 240)}**`)
    .addFields(
      { name: 'From', value: from.slice(0, 100), inline: true },
      { name: 'To', value: to.slice(0, 100) || inbox.imap.user, inline: true },
      { name: 'Date', value: date, inline: false },
      { name: 'Inbox', value: `${inbox.emoji} ${inbox.name}`, inline: true },
      { name: 'UID', value: String(email.uid), inline: true },
    )
    .setFooter({ text: `CO Inbox System | UID: ${email.uid} | View full email at mail.communityorg.co.uk` })
    .setTimestamp();

  if (replies.length > 0) {
    const replyLines = replies.map(r =>
      `**${r.replied_by_name || r.replied_by_discord_id}** — <t:${Math.floor(new Date(r.replied_at).getTime() / 1000)}:R> · Code: \`${r.reply_code}\``
    ).join('\n');
    embed.addFields({ name: `Replied (${replies.length})`, value: replyLines.slice(0, 1024), inline: false });
  } else {
    embed.addFields({ name: 'Status', value: 'No replies yet', inline: false });
  }

  return embed;
}

function buildEmailNotifButtons(inboxId, uid) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inbox_notif_reply|${inboxId}|${uid}`)
      .setLabel('Reply')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`inbox_notif_forward|${inboxId}|${uid}`)
      .setLabel('Forward')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`inbox_notif_view|${inboxId}|${uid}`)
      .setLabel('View Email')
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function pollAllInboxes(client) {
  if (backoffShouldSkip()) return;
  try {
    const config = await fetchEmailConfig();
    clearDedupedError('Email Poller fatal');
    backoffOnSuccess();

    for (const [inboxId, inbox] of Object.entries(config)) {
      try {
        const channelId = getInboxChannelId(inboxId);
        if (!channelId) continue;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;

        const result = await fetchInboxEmails(inbox, 0, 20).catch(() => null);
        if (!result || result.emails.length === 0) continue;

        for (const email of result.emails) {
          if (isEmailSeen(inboxId, email.uid)) continue;

          const subject = email.headers?.subject?.[0] || '(no subject)';
          const from = email.headers?.from?.[0] || 'Unknown';
          const embed = buildEmailNotifEmbed(inbox, email, []);
          const buttons = buildEmailNotifButtons(inboxId, email.uid);

          const msg = await channel.send({ embeds: [embed], components: [buttons] }).catch(e => {
            console.error(`[Email Poller] Failed to send to ${channel.name}:`, e.message);
            return null;
          });

          if (msg) {
            markEmailSeen(inboxId, email.uid, subject, from, msg.id, channelId);
            console.log(`[Email Poller] New email in ${inboxId}: ${subject}`);

            const logChannelId = getInboxChannelId('__email_log__');
            if (logChannelId) {
              const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
              if (logChannel) {
                const logEmbed = new EmbedBuilder()
                  .setTitle(`New Email — ${inbox.emoji} ${inbox.name}`)
                  .setColor(0x1a73e8)
                  .setDescription(`${E.dm} **New Email — ${inbox.name}**`)
                  .addFields(
                    { name: 'From', value: from.slice(0, 100), inline: true },
                    { name: 'Subject', value: subject.slice(0, 100), inline: true },
                    { name: 'Inbox', value: inbox.name, inline: true },
                  )
                  .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
              }
            }
          }
        }
      } catch (e) {
        console.error(`[Email Poller] Error polling ${inboxId}:`, e.message);
      }
    }
  } catch (e) {
    backoffOnFailure();
    // Pass only the error message (NOT the variable fails/nextAt suffix)
    // to the dedupe key — otherwise the message string is unique on every
    // attempt and dedupe never matches, so the same root cause spams the
    // log every minute. The fails/nextAt context goes into the message
    // body, which the dedupe formatter prints once and then suppresses.
    logDedupedError('Email Poller fatal', e.message);
  }
}

export async function updateNotifEmbed(client, inboxId, uid) {
  try {
    const seen = getSeenEmail(inboxId, uid);
    if (!seen?.notification_message_id || !seen?.notification_channel_id) return;

    const channel = await client.channels.fetch(seen.notification_channel_id).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(seen.notification_message_id).catch(() => null);
    if (!msg) return;

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const fakeEmail = {
      headers: {
        subject: [seen.subject || '(no subject)'],
        from: [seen.from_address || 'Unknown'],
        to: [inbox.imap.user],
        date: [seen.received_at],
      },
      uid,
    };

    const replies = getRepliesForEmail(inboxId, uid);
    const embed = buildEmailNotifEmbed(inbox, fakeEmail, replies);
    const buttons = buildEmailNotifButtons(inboxId, uid);

    await msg.edit({ embeds: [embed], components: [buttons] }).catch(e =>
      console.error('[Email Poller] Failed to update embed:', e.message)
    );
  } catch (e) {
    console.error('[Email Poller] updateNotifEmbed error:', e.message);
  }
}

export { buildEmailNotifEmbed, buildEmailNotifButtons, generateReplyCode };

export async function pollPersonalInboxes(client) {
  try {
    const { db, getAllPersonalEmailSetups, isPersonalEmailSeen, markPersonalEmailSeen } = await import('../utils/botDb.js');
    const { fetchInboxEmails } = await import('./emailService.js');
    const setups = getAllPersonalEmailSetups();

    for (const setup of setups) {
      try {
        const fakeInbox = {
          inbox_id: `personal_${setup.discord_id}`,
          name: 'Personal Inbox',
          emoji: '📧',
          imap: {
            host: setup.imap_host,
            port: setup.imap_port,
            user: setup.co_email,
            password: setup.imap_password,
            secure: setup.imap_port === 993,
          },
          folders: { inbox: 'INBOX' },
        };

        // Fetch 50 on first run to seed seen history, otherwise 10
        const seededAlready = db.prepare('SELECT COUNT(*) as c FROM personal_email_seen WHERE discord_id = ?').get(setup.discord_id)?.c || 0;
        const fetchLimit = seededAlready === 0 ? 50 : 10;
        const result = await fetchInboxEmails(fakeInbox, 0, fetchLimit).catch(() => null);
        if (!result || result.emails.length === 0) continue;

        if (seededAlready === 0) {
          // First run — seed all existing emails as seen, no notifications
          for (const email of result.emails) {
            const subject = email.headers?.subject?.[0] || '(no subject)';
            const from = email.headers?.from?.[0] || 'Unknown';
            markPersonalEmailSeen(setup.discord_id, email.uid, subject, from);
          }
          console.log(`[Personal Poller] First run for ${setup.discord_id} — seeded ${result.emails.length} existing emails, no notifications`);
          continue;
        }

        const user = await client.users.fetch(setup.discord_id).catch(() => null);
        if (!user) continue;

        for (const email of result.emails) {
          if (isPersonalEmailSeen(setup.discord_id, email.uid)) continue;

          const subject = email.headers?.subject?.[0] || '(no subject)';
          const from = email.headers?.from?.[0] || 'Unknown';
          const date = email.headers?.date?.[0] ? `<t:${Math.floor(new Date(email.headers.date[0]).getTime() / 1000)}:R>` : '';
          const to = email.headers?.to?.[0] || setup.co_email;

          // Fetch email body for content preview
          let bodyPreview = '';
          try {
            const { fetchEmailBody } = await import('./emailService.js');
            const fullEmail = await Promise.race([
              fetchEmailBody(fakeInbox, email.uid),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
            ]);
            const rawText = fullEmail.text || '';
            bodyPreview = rawText.slice(0, 800).trim();
            if (rawText.length > 800) bodyPreview += '...';
          } catch { /* skip body if fetch fails */ }

          const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');

          const embed = new EmbedBuilder()
            .setTitle(subject.slice(0, 240))
            .setColor(0x1a73e8)
            .setDescription(`${E.dm} **${subject.slice(0, 240)}**`)
            .addFields(
              { name: 'From', value: from.slice(0, 100), inline: true },
              { name: 'To', value: to.slice(0, 100), inline: true },
              { name: 'Date', value: date, inline: false },
              ...(bodyPreview ? [{ name: 'Message', value: bodyPreview.slice(0, 1024), inline: false }] : []),
              { name: 'Status', value: 'No replies yet', inline: false },
            )
            .setFooter({ text: `Personal Inbox | UID: ${email.uid} | View full email at mail.communityorg.co.uk` })
            .setTimestamp();

          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`inbox_personal_reply|${setup.discord_id}|${email.uid}`)
              .setLabel('Reply')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`inbox_personal_forward|${setup.discord_id}|${email.uid}`)
              .setLabel('Forward')
              .setStyle(ButtonStyle.Secondary),
          );

          await user.send({ embeds: [embed], components: [buttons] }).catch(e =>
            console.error(`[Personal Poller] Failed to DM ${setup.discord_id}:`, e.message)
          );

          markPersonalEmailSeen(setup.discord_id, email.uid, subject, from);
          console.log(`[Personal Poller] Notified ${setup.discord_id} — ${subject}`);
        }
      } catch (e) {
        logDedupedError(`Personal Poller ${setup.discord_id}`, e.message);
        if (e.message?.toLowerCase().includes('auth') || e.message?.toLowerCase().includes('login') || e.message?.toLowerCase().includes('password')) {
          try {
            const user = await client.users.fetch(setup.discord_id).catch(() => null);
            if (user) await user.send(`${E.warning} **Email monitoring error** — Could not connect to \`${setup.co_email}\`: \`${e.message}\`

Please run \`/setup-email configure\` to update your password.`).catch(() => {});
          } catch { /* ignore */ }
        }
      }
    }
  } catch (e) {
    logDedupedError('Personal Poller fatal', e.message);
  }
}
