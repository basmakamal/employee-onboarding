/**
 * Branded HTML wrapper for outbound email — Riyada HR.
 *
 * Every message keeps its plain-text body (deliverability, text-only clients,
 * and the in-app notification log store it); this adds the HTML alternative
 * that most recipients will actually see.
 *
 * Email rendering is not web rendering. The constraints below are deliberate:
 *   - Tables for layout. Outlook (Word engine) ignores flex and grid.
 *   - Inline styles only. Gmail strips <style> blocks in many contexts.
 *   - No SVG. Outlook and Gmail will not render it, which is why the logo is
 *     referenced as a PNG rather than reusing the site's SVG.
 *   - No web fonts. They silently fall back, so use a stack that degrades well
 *     in both Arabic and Latin.
 *   - 600px max. The long-standing safe width for desktop clients.
 */
import { config } from '../common/config.js';

/** Sampled from the Riyada mark. */
const BRAND = {
  teal: '#35708F', // the swoosh
  green: '#4E9E8F', // the dots
  ink: '#2C3A42',
  muted: '#7A8B8A',
  line: '#E3E9EA',
  page: '#F4F7F7',
  white: '#FFFFFF',
} as const;

const FONT_AR = "'Segoe UI', Tahoma, Arial, sans-serif";
const FONT_EN = "'Segoe UI', Arial, Helvetica, sans-serif";

export interface EmailBlock {
  /** Heading shown above the body copy. */
  title: string;
  /** Paragraphs, already plain text; each becomes its own <p>. */
  paragraphs: string[];
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the button (e.g. link expiry). */
  note?: string;
}

/** Escape anything interpolated into the HTML. Params come from user data. */
function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The logo must be a PNG at a publicly reachable URL: email clients cannot
 * render the site's SVG, and Gmail strips base64 data URIs. Drop the file at
 * frontend/public/riyada-logo.png so it is served next to the app.
 *
 * If the file is missing the <img> simply fails to load and the alt text
 * ("Riyada HR") shows instead — the email stays readable either way.
 */
function logoUrl(): string {
  return `${config.APP_URL.replace(/\/+$/, '')}/riyada-logo.png`;
}

export function renderEmail(block: EmailBlock, locale: 'ar' | 'en'): string {
  const rtl = locale === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? FONT_AR : FONT_EN;

  const paragraphs = block.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${BRAND.ink};">${esc(p)}</p>`,
    )
    .join('');

  // Bulletproof-ish button: a padded anchor. VML would be needed for perfect
  // Outlook rounded corners; a square-ish 4px radius degrades acceptably.
  const cta = block.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
         <tr><td align="center" bgcolor="${BRAND.teal}" style="border-radius:4px;">
           <a href="${esc(block.cta.url)}"
              style="display:inline-block;padding:12px 28px;font-family:${font};
                     font-size:15px;font-weight:600;color:${BRAND.white};
                     text-decoration:none;border-radius:4px;">${esc(block.cta.label)}</a>
         </td></tr>
       </table>`
    : '';

  // Some clients strip the button; always give the raw URL as a fallback so the
  // recipient is never stuck with a dead-looking email.
  const rawLink = block.cta
    ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
         <span style="display:block;margin-bottom:3px;">${rtl ? 'أو انسخ الرابط التالي:' : 'Or copy this link:'}</span>
         <a href="${esc(block.cta.url)}" style="color:${BRAND.teal};word-break:break-all;">${esc(block.cta.url)}</a>
       </p>`
    : '';

  const note = block.note
    ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.6;color:${BRAND.muted};">${esc(block.note)}</p>`
    : '';

  return `<!doctype html>
<html dir="${dir}" lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(block.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};">
  <!-- Preheader: the grey preview line in the inbox list. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(block.paragraphs[0] ?? '')}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${BRAND.page};padding:28px 12px;">
    <tr><td align="center">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;background:${BRAND.white};
                    border:1px solid ${BRAND.line};border-radius:8px;overflow:hidden;">

        <!-- Brand bar -->
        <tr>
          <td style="padding:20px 28px;border-bottom:1px solid ${BRAND.line};" align="${align}">
            <img src="${logoUrl()}" alt="Riyada HR" height="34"
                 style="height:34px;width:auto;border:0;display:block;">
          </td>
        </tr>

        <!-- Accent rule: the two brand colours, no gradient (Outlook ignores them) -->
        <tr>
          <td style="font-size:0;line-height:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="65%" bgcolor="${BRAND.teal}" style="height:3px;font-size:0;line-height:0;">&nbsp;</td>
                <td width="35%" bgcolor="${BRAND.green}" style="height:3px;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td dir="${dir}" align="${align}"
              style="padding:26px 28px 28px;font-family:${font};text-align:${align};">
            <h1 style="margin:0 0 14px;font-size:19px;line-height:1.4;font-weight:700;color:${BRAND.ink};">
              ${esc(block.title)}
            </h1>
            ${paragraphs}
            ${cta}
            ${rawLink}
            ${note}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td dir="${dir}" align="${align}"
              style="padding:16px 28px 20px;background:#FAFCFC;border-top:1px solid ${BRAND.line};
                     font-family:${font};text-align:${align};">
            <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
              ${rtl ? 'قسم الموارد البشرية — Riyada HR' : 'HR Department — Riyada HR'}
            </p>
            <p style="margin:6px 0 0;font-size:11.5px;line-height:1.6;color:${BRAND.muted};">
              ${rtl
                ? 'هذه رسالة آلية، يُرجى عدم الرد عليها.'
                : 'This is an automated message — please do not reply.'}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
