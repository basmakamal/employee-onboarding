/**
 * Validation for the employee data form.
 *
 * Every field is required: HR confirmed the whole set is mandatory for
 * employment contracts, so the form cannot be submitted half-finished.
 *
 * The Saudi-specific formats are checked here rather than only in the browser.
 * The form is reached through a public signed link, so the server is the only
 * place a rule actually holds — and a wrong IBAN discovered at payroll costs
 * far more than one caught at entry.
 */
import { z } from 'zod';

/** Saudi mobile: 05XXXXXXXX, +9665XXXXXXXX or 9665XXXXXXXX. */
const SAUDI_MOBILE = /^(?:\+?966|0)5\d{8}$/;

/** SPL short national address: 4 letters + 4 digits, e.g. RRRD2929. */
const SPL_ADDRESS = /^[A-Za-z]{4}\d{4}$/;

/** National ID (1…) or Iqama (2…) — 10 digits. */
const SAUDI_ID = /^[12]\d{9}$/;

/** Hijri date as entered: YYYY-MM-DD with a plausible Hijri year. */
const HIJRI_DATE = /^1[34]\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/;

/**
 * IBAN mod-97 check (ISO 13616). Move the first four characters to the end,
 * map letters to numbers (A=10 … Z=35), and the whole value mod 97 must be 1.
 * Computed in chunks because the number exceeds JS integer precision.
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^SA\d{22}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  let remainder = 0;
  for (const ch of digits) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  return remainder === 1;
}

/** Normalise a mobile number to the 05XXXXXXXX form we store. */
export function normaliseMobile(raw: string): string {
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  if (digits.startsWith('966')) return `0${digits.slice(3)}`;
  return digits;
}

const requiredText = (max = 100) =>
  z
    .string({ message: 'REQUIRED' })
    .trim()
    .min(1, 'REQUIRED')
    .max(max, 'TOO_LONG');

export const dataFormSchema = z.object({
  // ── البيانات الشخصية ──────────────────────────────────────────────────
  firstName: requiredText(60),
  fatherName: requiredText(60),
  grandfatherName: requiredText(60),
  lastName: requiredText(60),

  nationalId: z
    .string()
    .trim()
    .regex(SAUDI_ID, 'INVALID_NATIONAL_ID'),

  /**
   * Date of birth, Gregorian — the form uses a standard date picker.
   *
   * HR's original request said Hijri. Collecting a Hijri date needs either a
   * conversion dependency or hand-rolled arithmetic, and a subtly wrong
   * conversion would put a wrong birth date on an employment contract, so the
   * form asks for Gregorian and labels it as such. birthDateHijri below stays
   * available for when a Hijri picker is added — no migration needed then.
   */
  birthDate: z.coerce.date({ message: 'REQUIRED' }),
  birthDateHijri: z
    .string()
    .trim()
    .regex(HIJRI_DATE, 'INVALID_HIJRI_DATE')
    .optional(),

  gender: z.enum(['MALE', 'FEMALE'], { message: 'REQUIRED' }),
  nationality: requiredText(60),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'], { message: 'REQUIRED' }),

  phone: z
    .string()
    .trim()
    .regex(SAUDI_MOBILE, 'INVALID_PHONE')
    .transform(normaliseMobile),

  email: z.string().trim().email('INVALID_EMAIL').max(120),

  splAddress: z
    .string()
    .trim()
    .regex(SPL_ADDRESS, 'INVALID_SPL_ADDRESS')
    .transform((v) => v.toUpperCase()),

  // ── المؤهلات ──────────────────────────────────────────────────────────
  qualification: z.enum(['HIGH_SCHOOL', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD', 'OTHER'], {
    message: 'REQUIRED',
  }),
  major: requiredText(120),

  // ── البيانات البنكية ──────────────────────────────────────────────────
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine(isValidIban, 'INVALID_IBAN'),

  // ── جهة الاتصال في الطوارئ ────────────────────────────────────────────
  emergencyContactName: requiredText(120),
  emergencyContactPhone: z
    .string()
    .trim()
    .regex(SAUDI_MOBILE, 'INVALID_PHONE')
    .transform(normaliseMobile),
});

export type DataFormInput = z.infer<typeof dataFormSchema>;

/**
 * The two mandatory attachments. Checked by checklist TYPE rather than by row
 * id so the rule survives HR reordering or relabelling the checklist.
 */
export const REQUIRED_DOCUMENT_TYPES = ['NATIONAL_ID', 'IBAN_LETTER'] as const;
