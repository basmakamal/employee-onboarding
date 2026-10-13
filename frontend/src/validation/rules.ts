/**
 * Field rules for Vuetify `:rules` — one translated message per rule, the
 * same wording the server's refusals use. They mirror the API's checks so a
 * person sees the problem before submitting; the server still decides.
 *
 *   <v-text-field v-model="x" :rules="[rules.required, rules.email]" />
 */
import { i18n } from '../i18n';

type Rule = (value: unknown) => true | string;
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/** Unit / title codes: letters or digits first (CS-CALL, 52). Same as the API. */
export const UNIT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
/** Company / role / team handles: a letter first (RIYADA, PAYROLL). Same as the API. */
export const HANDLE_RE = /^[A-Za-z][A-Za-z0-9_]{1,60}$/;

export const rules = {
  required: ((v) => (Array.isArray(v) ? v.length > 0 : text(v) !== '') || t('errors.field.required')) as Rule,

  email: ((v) => !text(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(v)) || t('errors.field.email')) as Rule,

  /** Every entry of a chip list is an e-mail address (CC lists); names the first bad one. */
  emailList: ((v) => {
    if (!Array.isArray(v)) return true;
    const bad = v.map(text).find((x) => x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    return !bad || t('errors.field.emailList', { value: bad });
  }) as Rule,

  maxLength: (max: number): Rule => (v) => text(v).length <= max || t('errors.field.tooLong', { max }),
  minLength: (min: number): Rule => (v) => !text(v) || text(v).length >= min || t('errors.field.tooShort', { min }),

  /** A whole number ≥ min (empty passes — combine with required). */
  integer: (min = 0): Rule => (v) => {
    if (!text(v)) return true;
    const n = Number(text(v));
    if (!Number.isInteger(n)) return t('errors.field.number');
    return n >= min || t('errors.field.tooLow', { min });
  },
  /** Any number ≥ min (amounts). */
  number: (min = 0): Rule => (v) => {
    if (!text(v)) return true;
    const n = Number(text(v));
    if (Number.isNaN(n)) return t('errors.field.number');
    return n >= min || t('errors.field.tooLow', { min });
  },

  unitCode: ((v) => !text(v) || UNIT_CODE_RE.test(text(v)) || t('errors.field.unitCode')) as Rule,
  handle: ((v) => !text(v) || HANDLE_RE.test(text(v).toUpperCase()) || t('errors.field.handle')) as Rule,

  /** yyyy-mm-dd from a date input. */
  date: ((v) => !text(v) || !Number.isNaN(Date.parse(text(v))) || t('errors.field.date')) as Rule,

  /** Same value as another field (password confirmation). */
  sameAs: (other: () => unknown, key = 'errors.field.mismatch'): Rule => (v) => text(v) === text(other()) || t(key),
};
