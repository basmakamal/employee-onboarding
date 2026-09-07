import type { EmailTemplate, PrismaClient } from '../generated/prisma/client.js';
import { GuardFailedError, NotFoundError } from '../workflow/errors.js';
import { renderEmail } from './email-layout.js';
import { PLACEHOLDERS, TEMPLATE_CATALOG } from './template-catalog.js';
import { renderTemplate, type Locale, type RenderedMessage, type TemplateParams } from './templates.js';

const CACHE_MS = 30_000;

const SIGN_OFF: Record<Locale, string> = {
  ar: 'قسم الموارد البشرية — Riyada HR',
  en: 'HR Department — Riyada HR',
};
const LINK_NOTE: Record<Locale, string> = {
  ar: 'الرابط صالح لفترة محدودة ومخصص لك وحدك، يُرجى عدم مشاركته.',
  en: 'This link is valid for a limited time and is personal to you — please do not share it.',
};
const DEFAULT_CTA: Record<Locale, string> = { ar: 'فتح الرابط', en: 'Open the link' };

export interface TemplateDraft {
  name: string;
  subjectAr: string;
  subjectEn: string;
  bodyAr: string;
  bodyEn: string;
  ctaLabelAr?: string | null;
  ctaLabelEn?: string | null;
  active?: boolean;
}

export interface RenderedWithMeta extends RenderedMessage {
  templateKey: string;
  /** null = rendered from the built-in code template. */
  templateVersion: number | null;
}

/**
 * Replace `{{placeholder}}` tokens. Only catalogued names are honoured; an
 * unknown or misspelled token renders as nothing rather than leaking the
 * raw pattern — and never as unescaped user input, because the HTML layer
 * escapes every paragraph it receives.
 */
function fill(text: string, params: TemplateParams): string {
  const bag = params as Record<string, unknown>;
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, key: string) =>
    key in PLACEHOLDERS ? String(bag[key] ?? '') : '',
  );
}

/**
 * Email templates: the built-in set in `templates.ts`, optionally overridden
 * per key by an admin-edited row. Rendering always goes through here so the
 * override is honoured everywhere a template key is used.
 */
export class TemplateService {
  private cache: { rows: Map<string, EmailTemplate>; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly appUrl: string,
  ) {}

  private async rows(): Promise<Map<string, EmailTemplate>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rows;
    const all = await this.prisma.emailTemplate.findMany();
    const rows = new Map(all.map((r) => [r.key, r]));
    this.cache = { rows, at: Date.now() };
    return rows;
  }

  private invalidate(): void {
    this.cache = null;
  }

  /** Realistic values for previews and test sends. */
  sampleParams(locale: Locale): TemplateParams {
    const s = (k: string) => PLACEHOLDERS[k]?.sample[locale] ?? '';
    return {
      name: s('name'),
      employeeNo: s('employeeNo'),
      department: s('department'),
      jobTitle: s('jobTitle'),
      status: s('status'),
      daysWaiting: 3,
      daysLeft: 14,
      docType: s('docType'),
      docNumber: s('docNumber'),
      expiryDate: s('expiryDate'),
      linkUrl: `${this.appUrl}/form/preview-only`,
    };
  }

  /** The catalogue with each key's override state — the admin list view. */
  async list() {
    const rows = await this.rows();
    return Object.entries(TEMPLATE_CATALOG).map(([key, meta]) => {
      const row = rows.get(key);
      return {
        key,
        audience: meta.audience,
        nameAr: meta.nameAr,
        nameEn: meta.nameEn,
        hasCta: meta.hasCta,
        customized: !!row,
        active: row?.active ?? true,
        version: row?.version ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  /** One template for the editor: override row (if any) + code defaults + placeholders. */
  async get(key: string) {
    const meta = TEMPLATE_CATALOG[key];
    if (!meta) throw new NotFoundError('template', key);
    const row = (await this.rows()).get(key) ?? null;
    return {
      key,
      meta,
      row,
      defaults: this.defaults(key),
      placeholders: meta.placeholders.map((p) => ({ key: p, ...PLACEHOLDERS[p]! })),
    };
  }

  /**
   * Starting text for the editor: the code template rendered with the
   * placeholder tokens themselves as values, so "Hello {{name}}," comes out
   * ready to edit rather than a one-off sample.
   */
  private defaults(key: string) {
    const tokens: TemplateParams = {
      name: '{{name}}',
      employeeNo: '{{employeeNo}}',
      department: '{{department}}',
      jobTitle: '{{jobTitle}}',
      status: '{{status}}',
      docType: '{{docType}}',
      docNumber: '{{docNumber}}',
      expiryDate: '{{expiryDate}}',
      // Numeric fields drive conditionals in code templates; give them values.
      // linkUrl is left out on purpose: the editor adds the button itself.
      daysWaiting: 3,
      daysLeft: 14,
    };
    const safe = (locale: Locale) => {
      try {
        return renderTemplate(key, locale, tokens);
      } catch {
        return null; // custom.* keys have no code default
      }
    };
    const ar = safe('ar');
    const en = safe('en');
    const strip = (text: string | undefined) =>
      (text ?? '')
        .split('\n\n')
        .filter((p) => !Object.values(SIGN_OFF).includes(p))
        .join('\n\n');
    return {
      subjectAr: ar?.subject ?? '',
      subjectEn: en?.subject ?? '',
      bodyAr: strip(ar?.text),
      bodyEn: strip(en?.text),
    };
  }

  async upsert(key: string, draft: TemplateDraft, userId?: string): Promise<EmailTemplate> {
    if (!TEMPLATE_CATALOG[key]) throw new NotFoundError('template', key);
    if (!draft.subjectAr.trim() || !draft.subjectEn.trim() || !draft.bodyAr.trim() || !draft.bodyEn.trim()) {
      throw new GuardFailedError('TEMPLATE_INCOMPLETE', 'subject and body are required in both languages');
    }
    const data = {
      name: draft.name.trim() || TEMPLATE_CATALOG[key].nameEn,
      subjectAr: draft.subjectAr.trim(),
      subjectEn: draft.subjectEn.trim(),
      bodyAr: draft.bodyAr.trim(),
      bodyEn: draft.bodyEn.trim(),
      ctaLabelAr: draft.ctaLabelAr?.trim() || null,
      ctaLabelEn: draft.ctaLabelEn?.trim() || null,
      active: draft.active ?? true,
      updatedById: userId ?? null,
    };
    const row = await this.prisma.emailTemplate.upsert({
      where: { key },
      create: { key, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    this.invalidate();
    return row;
  }

  /** Back to the code default. */
  async revert(key: string): Promise<void> {
    await this.prisma.emailTemplate.deleteMany({ where: { key } });
    this.invalidate();
  }

  /** Production path: DB override when present and active, else code. */
  async render(key: string, locale: Locale, params: TemplateParams): Promise<RenderedWithMeta> {
    const row = (await this.rows()).get(key);
    if (row?.active) {
      return { ...this.renderDraft(row, locale, params), templateKey: key, templateVersion: row.version };
    }
    return { ...renderTemplate(key, locale, params), templateKey: key, templateVersion: null };
  }

  /** Preview: the saved/default version, or an unsaved draft from the editor. */
  async preview(key: string, locale: Locale, draft?: Partial<TemplateDraft>): Promise<RenderedMessage> {
    const params = this.sampleParams(locale);
    if (!draft) return this.render(key, locale, params);
    const base = (await this.rows()).get(key);
    const merged: TemplateDraft = {
      name: draft.name ?? base?.name ?? key,
      subjectAr: draft.subjectAr ?? base?.subjectAr ?? '',
      subjectEn: draft.subjectEn ?? base?.subjectEn ?? '',
      bodyAr: draft.bodyAr ?? base?.bodyAr ?? '',
      bodyEn: draft.bodyEn ?? base?.bodyEn ?? '',
      ctaLabelAr: draft.ctaLabelAr ?? base?.ctaLabelAr ?? null,
      ctaLabelEn: draft.ctaLabelEn ?? base?.ctaLabelEn ?? null,
    };
    return this.renderDraft(merged, locale, params);
  }

  /** Text + branded HTML from an admin-authored template. */
  renderDraft(draft: TemplateDraft, locale: Locale, params: TemplateParams): RenderedMessage {
    const subject = fill(locale === 'ar' ? draft.subjectAr : draft.subjectEn, params);
    const body = fill(locale === 'ar' ? draft.bodyAr : draft.bodyEn, params);
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const ctaLabel = (locale === 'ar' ? draft.ctaLabelAr : draft.ctaLabelEn) || DEFAULT_CTA[locale];
    const cta = params.linkUrl ? { label: ctaLabel, url: params.linkUrl } : undefined;

    const text =
      paragraphs.join('\n\n') +
      (cta ? `\n\n${cta.label}: ${cta.url}` : '') +
      `\n\n${SIGN_OFF[locale]}`;

    const html = renderEmail(
      {
        title: subject,
        paragraphs,
        ...(cta ? { cta, note: LINK_NOTE[locale] } : {}),
      },
      locale,
    );
    return { subject, text, html };
  }
}
