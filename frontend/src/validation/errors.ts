/**
 * Turns anything that went wrong into words a person can act on.
 *
 * The API answers every refusal with a stable `code` (and, for input
 * problems, one issue per field with its own code and numbers). Those codes
 * are translated here — the server's English text is only the last-resort
 * fallback, never what an Arabic user reads. Raw technical messages
 * (SQL, stack traces, "invalid request body") never reach the screen.
 */
import { i18n } from '../i18n';
import { ApiError } from '../api/client';

export interface FieldIssue {
  path: string;
  code: string;
  message?: string;
  params?: Record<string, string | number>;
}

export interface DescribedError {
  /** One sentence for the alert / snackbar. */
  message: string;
  /** Translated messages per field path — bind with :error-messages. */
  fields: Record<string, string[]>;
  /** "Label — message" lines for every field problem, for the alert list. */
  lines: string[];
}

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});
const te = (key: string) => i18n.global.te(key);

/** The human name of a field path ("orgUnitId" → "Branch / department"). */
export function fieldLabel(path: string): string {
  // "ccEmails.2" → "ccEmails": list positions are not field names.
  const leaf = path.split('.').filter((part) => !/^\d+$/.test(part)).at(-1) ?? path;
  return te(`errors.fields.${leaf}`) ? t(`errors.fields.${leaf}`) : leaf;
}

/** One field issue in words. Zod codes, plus the API's own (DUPLICATE, FILE_TOO_LARGE…). */
export function issueText(issue: FieldIssue): string {
  const p = issue.params ?? {};
  switch (issue.code) {
    case 'required':
      return t('errors.field.required');
    case 'too_small':
      return p['type'] === 'array'
        ? t('errors.field.tooFewItems', { min: p['minimum'] })
        : p['type'] === 'number'
          ? t('errors.field.tooLow', { min: p['minimum'] })
          : Number(p['minimum']) <= 1
            ? t('errors.field.required')
            : t('errors.field.tooShort', { min: p['minimum'] });
    case 'too_big':
      return p['type'] === 'array'
        ? t('errors.field.tooManyItems', { max: p['maximum'] })
        : p['type'] === 'number'
          ? t('errors.field.tooHigh', { max: p['maximum'] })
          : t('errors.field.tooLong', { max: p['maximum'] });
    case 'invalid_string':
      if (p['validation'] === 'email') return t('errors.field.email');
      if (p['validation'] === 'regex') return t('errors.field.format');
      return t('errors.field.invalid');
    case 'invalid_type':
      return p['expected'] === 'number' ? t('errors.field.number') : t('errors.field.invalid');
    case 'invalid_enum_value':
      return t('errors.field.choose');
    case 'invalid_date':
      return t('errors.field.date');
    default:
      if (te(`errors.codes.${issue.code}`)) return t(`errors.codes.${issue.code}`);
      return t('errors.field.invalid');
  }
}

export function describeError(e: unknown): DescribedError {
  if (!(e instanceof ApiError)) {
    // Network down, CORS, a thrown string… the browser's own wording is not for people.
    const offline = e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
    return { message: offline ? t('errors.codes.NETWORK') : t('errors.codes.INTERNAL'), fields: {}, lines: [] };
  }

  const fields: Record<string, string[]> = {};
  const lines: string[] = [];
  for (const issue of (e.details ?? []) as FieldIssue[]) {
    if (!issue?.path) continue;
    const text = issueText(issue);
    (fields[issue.path] ??= []).push(text);
    lines.push(`${fieldLabel(issue.path)} — ${text}`);
  }

  let message: string;
  if (te(`errors.codes.${e.code}`)) message = t(`errors.codes.${e.code}`);
  else if (e.status >= 500) message = t('errors.codes.INTERNAL');
  // A business rule we have no translation for yet: the server's sentence is
  // still more useful than "error" — and it never contains internals.
  else message = e.message || t('errors.codes.INTERNAL');
  return { message, fields, lines };
}

/** The single sentence for a snackbar: the message, plus the first field problem when there is one. */
export function errorText(e: unknown): string {
  const d = describeError(e);
  return d.lines.length ? `${d.message} ${d.lines[0]}${d.lines.length > 1 ? ` (+${d.lines.length - 1})` : ''}` : d.message;
}
