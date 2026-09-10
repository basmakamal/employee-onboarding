import type { EmailTemplate, PrismaClient } from '../generated/prisma/client.js';
import { GuardFailedError, NotFoundError } from '../workflow/errors.js';
import { renderEmail } from './email-layout.js';
import { PLACEHOLDERS, TEMPLATE_CATALOG, type TemplateMeta } from './template-catalog.js';
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

/** Admin-created templates live under this prefix; the catalogue never uses it for its own keys except the generic status message. */
const CUSTOM_PREFIX = 'custom.';
/** What a custom template can reference: whatever every trigger / reminder provides. */
const CUSTOM_PLACEHOLDERS = [
  'name',
  'employeeNo',
  'department',
  'jobTitle',
  'status',
  'contractSalary',
  'contractDuration',
  'contractStartDate',
  'contractEndDate',
  'contractTerms',
  'contractRef',
  'formLink',
  'contractLink',
];

/** The placeholders that cost something to provide: each one issues a signed link. */
function mentions(
  row: Pick<EmailTemplate, 'subjectAr' | 'subjectEn' | 'bodyAr' | 'bodyEn'>,
  placeholder: string,
): boolean {
  const token = new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`);
  return token.test([row.subjectAr, row.subjectEn, row.bodyAr, row.bodyEn].join('\n'));
}

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

/** Where a template's key may be referenced, for the delete guard. */
export interface TemplateUsage {
  triggers: number;
  rules: number;
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

/** "Contract active (IT)" → "contract-active-it" */
function slugify(name: string): string {
  const ascii = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return ascii || 'template';
}

/**
 * Email templates: the built-in set in `templates.ts`, optionally overridden
 * per key by an admin-edited row, plus admin-created templates (`custom.*`)
 * that exist only in the database. Rendering always goes through here so the
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

  /** A DB-only template — never in the catalogue. */
  private isCustom(key: string, row: EmailTemplate | undefined): row is EmailTemplate {
    return !!row && !TEMPLATE_CATALOG[key] && key.startsWith(CUSTOM_PREFIX);
  }

  private customMeta(row: EmailTemplate): TemplateMeta {
    return {
      audience: row.audience === 'employee' ? 'employee' : 'staff',
      nameAr: row.name,
      nameEn: row.name,
      placeholders: CUSTOM_PLACEHOLDERS,
      // A template that carries a signed link gets the button (and its label fields).
      hasCta: mentions(row, 'formLink') || mentions(row, 'contractLink'),
    };
  }

  /**
   * Does this admin-created template use {{formLink}} / {{contractLink}}? The
   * trigger asks before issuing, because issuing one link invalidates the
   * previous link of that purpose.
   */
  async usesFormLink(key: string): Promise<boolean> {
    const row = (await this.rows()).get(key);
    return !!row && this.isCustom(key, row) && mentions(row, 'formLink');
  }

  /**
   * Built-ins declare the link in the catalogue; admin-created ones ask for it
   * by writing the token, so both paths are checked.
   */
  async usesContractLink(key: string): Promise<boolean> {
    if (TEMPLATE_CATALOG[key]?.placeholders.includes('contractLink')) return true;
    const row = (await this.rows()).get(key);
    return !!row && this.isCustom(key, row) && mentions(row, 'contractLink');
  }

  /** Catalogue meta or, for an admin-created template, meta derived from its row. */
  async metaOf(key: string): Promise<TemplateMeta | null> {
    const fromCatalog = TEMPLATE_CATALOG[key];
    if (fromCatalog) return fromCatalog;
    const row = (await this.rows()).get(key);
    return this.isCustom(key, row) ? this.customMeta(row) : null;
  }

  /** Does this key resolve to something that can be sent? (trigger / rule validation) */
  async exists(key: string): Promise<boolean> {
    return (await this.metaOf(key)) !== null;
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
      email: s('email'),
      tempPassword: s('tempPassword'),
      daysWaiting: 3,
      daysLeft: 14,
      docType: s('docType'),
      docNumber: s('docNumber'),
      expiryDate: s('expiryDate'),
      linkUrl: `${this.appUrl}/form/preview-only`,
      formLink: `${this.appUrl}/form/preview-only`,
      contractLink: `${this.appUrl}/contract/preview-only`,
      contractSalary: s('contractSalary'),
      contractDuration: s('contractDuration'),
      contractStartDate: s('contractStartDate'),
      contractEndDate: s('contractEndDate'),
      contractTerms: s('contractTerms'),
      contractRef: s('contractRef'),
    };
  }

  /** The catalogue with each key's override state, then the admin-created ones — the list view. */
  async list() {
    const rows = await this.rows();
    const builtIn = Object.entries(TEMPLATE_CATALOG).map(([key, meta]) => {
      const row = rows.get(key);
      return {
        key,
        custom: false,
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
    const custom = [...rows.values()]
      .filter((row) => this.isCustom(row.key, row))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => {
        const meta = this.customMeta(row);
        return {
          key: row.key,
          custom: true,
          audience: meta.audience,
          nameAr: row.name,
          nameEn: row.name,
          hasCta: false,
          customized: true,
          active: row.active,
          version: row.version,
          updatedAt: row.updatedAt,
        };
      });
    return [...builtIn, ...custom];
  }

  /** One template for the editor: override row (if any) + code defaults + placeholders. */
  async get(key: string) {
    const meta = await this.metaOf(key);
    if (!meta) throw new NotFoundError('template', key);
    const row = (await this.rows()).get(key) ?? null;
    return {
      key,
      custom: this.isCustom(key, row ?? undefined),
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
      email: '{{email}}',
      tempPassword: '{{tempPassword}}',
      docType: '{{docType}}',
      docNumber: '{{docNumber}}',
      expiryDate: '{{expiryDate}}',
      contractSalary: '{{contractSalary}}',
      contractDuration: '{{contractDuration}}',
      contractStartDate: '{{contractStartDate}}',
      contractEndDate: '{{contractEndDate}}',
      contractTerms: '{{contractTerms}}',
      contractRef: '{{contractRef}}',
      // Numeric fields drive conditionals in code templates; give them values.
      // linkUrl is left out on purpose: the editor adds the button itself.
      daysWaiting: 3,
      daysLeft: 14,
    };
    const safe = (locale: Locale) => {
      try {
        return renderTemplate(key, locale, tokens);
      } catch {
        return null; // admin-created keys have no code default
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

  private assertComplete(draft: TemplateDraft): void {
    if (!draft.subjectAr.trim() || !draft.subjectEn.trim() || !draft.bodyAr.trim() || !draft.bodyEn.trim()) {
      throw new GuardFailedError('TEMPLATE_INCOMPLETE', 'subject and body are required in both languages');
    }
  }

  private rowData(draft: TemplateDraft, fallbackName: string, userId?: string) {
    return {
      name: draft.name.trim() || fallbackName,
      subjectAr: draft.subjectAr.trim(),
      subjectEn: draft.subjectEn.trim(),
      bodyAr: draft.bodyAr.trim(),
      bodyEn: draft.bodyEn.trim(),
      ctaLabelAr: draft.ctaLabelAr?.trim() || null,
      ctaLabelEn: draft.ctaLabelEn?.trim() || null,
      active: draft.active ?? true,
      updatedById: userId ?? null,
    };
  }

  /**
   * Admin creates a brand-new template. The key is derived from the name and
   * kept unique; it can then be picked by triggers and automation rules.
   */
  async create(
    draft: TemplateDraft & { audience: 'employee' | 'staff' },
    userId?: string,
  ): Promise<EmailTemplate> {
    this.assertComplete(draft);
    const rows = await this.rows();
    const base = `${CUSTOM_PREFIX}${slugify(draft.name)}`;
    let key = base;
    for (let n = 2; rows.has(key) || TEMPLATE_CATALOG[key]; n += 1) key = `${base}-${n}`;
    const row = await this.prisma.emailTemplate.create({
      data: { key, audience: draft.audience, ...this.rowData(draft, draft.name.trim(), userId) },
    });
    this.invalidate();
    return row;
  }

  async upsert(key: string, draft: TemplateDraft, userId?: string): Promise<EmailTemplate> {
    const meta = await this.metaOf(key);
    if (!meta) throw new NotFoundError('template', key);
    this.assertComplete(draft);
    const data = this.rowData(draft, meta.nameEn, userId);
    const row = await this.prisma.emailTemplate.upsert({
      where: { key },
      create: { key, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    this.invalidate();
    return row;
  }

  /** Where a key is referenced — deleting a template in use would break those senders. */
  async usage(key: string): Promise<TemplateUsage> {
    const [triggers, rules] = await Promise.all([
      this.prisma.emailTrigger.count({ where: { templateKey: key } }),
      this.prisma.slaRule.count({ where: { OR: [{ subjectTemplateKey: key }, { staffTemplateKey: key }] } }),
    ]);
    return { triggers, rules };
  }

  /**
   * Built-in key: back to the code default. Admin-created key: the template
   * is removed — refused while a trigger or rule still points at it.
   */
  async revert(key: string): Promise<void> {
    const row = (await this.rows()).get(key);
    if (this.isCustom(key, row)) {
      const used = await this.usage(key);
      if (used.triggers + used.rules > 0) {
        throw new GuardFailedError(
          'TEMPLATE_IN_USE',
          `this template is used by ${used.triggers} trigger(s) and ${used.rules} automation rule(s)`,
        );
      }
    }
    await this.prisma.emailTemplate.deleteMany({ where: { key } });
    this.invalidate();
  }

  /** Production path: DB override when present and active, else code. */
  async render(key: string, locale: Locale, params: TemplateParams): Promise<RenderedWithMeta> {
    const row = (await this.rows()).get(key);
    if (row?.active) {
      return { ...this.renderDraft(row, locale, params), templateKey: key, templateVersion: row.version };
    }
    if (this.isCustom(key, row)) {
      // Switched off by the admin: send nothing rather than a code fallback that does not exist.
      throw new GuardFailedError('TEMPLATE_INACTIVE', `template ${key} is switched off`);
    }
    return { ...renderTemplate(key, locale, params), templateKey: key, templateVersion: null };
  }

  /** Preview: the saved/default version, or an unsaved draft from the editor. */
  async preview(key: string, locale: Locale, draft?: Partial<TemplateDraft>): Promise<RenderedMessage> {
    const params = this.sampleParams(locale);
    const base = (await this.rows()).get(key);
    if (!draft) {
      if (base) return this.renderDraft(base, locale, params);
      return this.render(key, locale, params);
    }
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
