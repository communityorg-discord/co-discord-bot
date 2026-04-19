/**
 * CO-branded HTML email layout. One function for every outbound email.
 * Produces both an HTML body (table-based for email-client compat) and a
 * plain-text fallback.
 *
 * !!! THIS FILE IS DUPLICATED VERBATIM IN THE BOT REPO at src/lib/emailLayout.js
 * !!! If you change anything here, mirror it there. The two services can't
 * !!! share a module at runtime, so we accept the duplication.
 *
 * Usage:
 *   import { wrapEmail } from '../server/lib/emailLayout.js';
 *   const { html, text } = wrapEmail({
 *     preheader:  'One-line inbox preview',
 *     heading:    'Visible email heading',
 *     intro:      'Opening paragraph.',
 *     body:       [{ type: 'paragraph', text: '...' }, { type: 'callout', variant: 'info', text: '...' }],
 *     cta:        { label: 'Open portal', url: 'https://...', variant: 'primary' },
 *     metaTable:  [['Ref', 'CASE-1'], ['Deadline', '12 May 2026']],
 *     footerNote: 'Automated message — please do not reply directly.',
 *     signature:  { name: 'Dion M.', role: 'Data Protection Lead', team: 'Internal Advisory Council' },
 *   });
 *   await sendMail({ to, subject, html, text });
 *
 * Block types supported:
 *   { type: 'paragraph', text }
 *   { type: 'callout', variant: 'info'|'warning'|'success', title?, text }
 *   { type: 'table', rows: [[label, value], ...] }
 *   { type: 'list', items: ['...', '...'], ordered?: false }
 *   { type: 'divider' }
 *   { type: 'button', label, url, variant?: 'primary'|'secondary' }
 *   { type: 'raw_html', html }    — escape hatch, also emits a text fallback via `text?: '...'`
 */

import { CO_BRAND_EMAIL as C, EMAIL_FONT_STACK as FONT } from './coBrandEmail.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function calloutPalette(variant) {
  if (variant === 'warning') return { bg: C.CALLOUT_WARNING_BG, border: C.CALLOUT_WARNING_BORDER, text: C.CALLOUT_WARNING_TEXT };
  if (variant === 'success') return { bg: C.CALLOUT_SUCCESS_BG, border: C.CALLOUT_SUCCESS_BORDER, text: C.CALLOUT_SUCCESS_TEXT };
  return { bg: C.CALLOUT_INFO_BG, border: C.CALLOUT_INFO_BORDER, text: C.CALLOUT_INFO_TEXT };
}

function renderButtonHtml({ label, url, variant = 'primary' }) {
  const bg = variant === 'secondary' ? C.BUTTON_SECONDARY_BG : C.BUTTON_PRIMARY_BG;
  const fg = variant === 'secondary' ? C.BUTTON_SECONDARY_TEXT : C.BUTTON_PRIMARY_TEXT;
  // VML button for Outlook + table fallback for everyone else
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
        <tr>
          <td align="left">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:44px;v-text-anchor:middle;width:260px;" arcsize="8%" fillcolor="${bg}" stroke="f">
              <w:anchorlock/>
              <center style="color:${fg};font-family:${FONT};font-size:15px;font-weight:bold;letter-spacing:0.02em;">${esc(label)}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${esc(url)}"
               style="display:inline-block;background:${bg};color:${fg};text-decoration:none;padding:13px 28px;border-radius:4px;font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:0.02em;mso-hide:all;">
              ${esc(label)}
            </a>
            <!--<![endif]-->
          </td>
        </tr>
      </table>`;
}

function renderBlockHtml(block) {
  if (!block || !block.type) return '';
  switch (block.type) {
    case 'paragraph':
      return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.BODY_INK};">${esc(block.text)}</p>`;

    case 'callout': {
      const { bg, border, text } = calloutPalette(block.variant || 'info');
      const title = block.title
        ? `<div style="font-family:${FONT};font-size:13px;font-weight:bold;color:${text};margin:0 0 6px 0;letter-spacing:0.04em;text-transform:uppercase;">${esc(block.title)}</div>`
        : '';
      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
        <tr>
          <td style="background:${bg};border:1px solid ${border};border-left:4px solid ${border};border-radius:4px;padding:14px 18px;">
            ${title}
            <div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${text};">${esc(block.text)}</div>
          </td>
        </tr>
      </table>`;
    }

    case 'table': {
      if (!Array.isArray(block.rows) || !block.rows.length) return '';
      const rows = block.rows.map(([label, value], idx) => {
        const bg = idx % 2 === 0 ? C.WHITE : C.LIGHT_GREY;
        return `
          <tr>
            <td style="background:${bg};padding:10px 14px;font-family:${FONT};font-size:13px;color:${C.NAVY};font-weight:bold;letter-spacing:0.02em;text-transform:uppercase;border-bottom:1px solid #E5E7EB;width:40%;">${esc(label)}</td>
            <td style="background:${bg};padding:10px 14px;font-family:${FONT};font-size:14px;color:${C.BODY_INK};border-bottom:1px solid #E5E7EB;">${esc(value)}</td>
          </tr>`;
      }).join('');
      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;border:1px solid #E5E7EB;border-collapse:collapse;">
        ${rows}
      </table>`;
    }

    case 'list': {
      const items = Array.isArray(block.items) ? block.items : [];
      if (!items.length) return '';
      const lis = items.map(it => `<li style="margin:0 0 6px 0;">${esc(it)}</li>`).join('');
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag} style="margin:12px 0 16px 0;padding-left:22px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.BODY_INK};">${lis}</${tag}>`;
    }

    case 'divider':
      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
        <tr><td style="border-top:1px solid ${C.GOLD};height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
      </table>`;

    case 'button':
      return renderButtonHtml(block);

    case 'raw_html':
      return String(block.html || '');

    default:
      return '';
  }
}

function renderBlockText(block) {
  if (!block || !block.type) return '';
  switch (block.type) {
    case 'paragraph':
      return block.text + '\n\n';
    case 'callout': {
      const t = block.title ? `[${block.title}] ` : '';
      return `| ${t}${block.text}\n| \n`;
    }
    case 'table':
      return Array.isArray(block.rows)
        ? block.rows.map(([l, v]) => `${l}: ${v}`).join('\n') + '\n\n'
        : '';
    case 'list':
      return (block.items || []).map(it => `- ${it}`).join('\n') + '\n\n';
    case 'divider':
      return '\n---\n\n';
    case 'button':
      return `${block.label}: ${block.url}\n\n`;
    case 'raw_html':
      return (block.text || '') + '\n';
    default:
      return '';
  }
}

export function wrapEmail({
  preheader,
  heading,
  intro,
  body = [],
  cta,
  metaTable,
  footerNote,
  signature,
} = {}) {
  const title = heading || 'Community Organisation';
  const preheaderText = preheader ? esc(preheader) : '';
  const introHtml = intro
    ? `<p style="margin:0 0 20px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.BODY_INK};">${esc(intro)}</p>`
    : '';
  const bodyHtml = body.map(renderBlockHtml).join('\n');
  const ctaHtml = cta ? renderButtonHtml(cta) : '';

  const metaTableHtml = Array.isArray(metaTable) && metaTable.length
    ? renderBlockHtml({ type: 'table', rows: metaTable })
    : '';

  let signatureHtml = '';
  if (signature && signature.name) {
    signatureHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;">
        <tr><td style="border-top:1px solid #E5E7EB;width:160px;height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding-top:14px;font-family:${FONT};font-size:14px;line-height:1.5;">
          <div style="color:${C.NAVY};font-weight:bold;">${esc(signature.name)}</div>
          ${signature.role ? `<div style="color:${C.DARK_GREY};font-size:13px;">${esc(signature.role)}</div>` : ''}
          ${signature.team ? `<div style="color:${C.DARK_GREY};font-size:13px;">${esc(signature.team)}</div>` : ''}
          ${!signature.team && !signature.role ? `<div style="color:${C.DARK_GREY};font-size:13px;">Community Organisation</div>` : ''}
        </td></tr>
      </table>`;
  } else {
    signatureHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;">
        <tr><td style="border-top:1px solid #E5E7EB;width:160px;height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding-top:14px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.DARK_GREY};">Community Organisation</td></tr>
      </table>`;
  }

  const footer = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.LIGHT_GREY};">
        <tr>
          <td align="center" style="padding:22px 32px;font-family:${FONT};font-size:12px;line-height:1.55;color:${C.DARK_GREY};">
            ${footerNote ? `<div style="margin-bottom:8px;">${esc(footerNote)}</div>` : '<div style="margin-bottom:8px;">Automated message \u2014 please do not reply directly to this email.</div>'}
            <div style="color:${C.NAVY};font-weight:bold;letter-spacing:0.05em;">Community Organisation</div>
            <div><a href="https://portal.communityorg.co.uk" style="color:${C.DARK_GREY};text-decoration:none;">portal.communityorg.co.uk</a></div>
          </td>
        </tr>
      </table>`;

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.LIGHT_GREY};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  ${preheaderText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;">${preheaderText}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.LIGHT_GREY};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${C.WHITE};border:1px solid #E5E7EB;border-radius:6px;overflow:hidden;">

          <!-- Navy masthead -->
          <tr>
            <td style="background:${C.NAVY};padding:18px 26px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="left" style="font-family:${FONT};font-size:22px;font-weight:bold;letter-spacing:0.04em;color:${C.GOLD};line-height:1;">CO
                    <span style="font-size:13px;font-weight:normal;color:${C.WHITE};margin-left:10px;letter-spacing:0.02em;">Community Organisation</span>
                  </td>
                  <td align="right" style="font-family:${FONT};font-size:11px;font-style:italic;color:${C.LIGHT_GOLD};">${esc(title)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Gold accent rule -->
          <tr>
            <td style="background:${C.GOLD};height:3px;line-height:3px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              ${heading ? `<h1 style="margin:0 0 14px 0;font-family:${FONT};font-size:22px;font-weight:bold;color:${C.NAVY};line-height:1.25;">${esc(heading)}</h1>` : ''}
              ${introHtml}
              ${bodyHtml}
              ${ctaHtml}
              ${metaTableHtml}
              ${signatureHtml}
            </td>
          </tr>

          <!-- Spacer -->
          <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>

          ${footer.replace(/\n/g, '')}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Plain-text fallback
  const textLines = [];
  if (preheader) { textLines.push(preheader); textLines.push(''); }
  if (heading) { textLines.push(heading.toUpperCase()); textLines.push(''.padEnd(heading.length, '=')); textLines.push(''); }
  if (intro) { textLines.push(intro); textLines.push(''); }
  for (const block of body) {
    const t = renderBlockText(block);
    if (t) textLines.push(t.replace(/\n{3,}/g, '\n\n').trimEnd());
  }
  if (cta) { textLines.push(''); textLines.push(`${cta.label}: ${cta.url}`); }
  if (Array.isArray(metaTable) && metaTable.length) {
    textLines.push('');
    textLines.push('---');
    for (const [label, value] of metaTable) textLines.push(`${label}: ${value}`);
  }
  textLines.push('');
  textLines.push('---');
  if (signature?.name) {
    textLines.push(signature.name);
    if (signature.role) textLines.push(signature.role);
    if (signature.team) textLines.push(signature.team);
    if (!signature.role && !signature.team) textLines.push('Community Organisation');
  } else {
    textLines.push('Community Organisation');
  }
  textLines.push('');
  textLines.push(footerNote || 'Automated message — please do not reply directly to this email.');
  textLines.push('portal.communityorg.co.uk');

  return { html, text: textLines.join('\n') };
}

export default wrapEmail;
