import { describe, expect, it } from 'vitest';
import { dataFormSchema, isValidIban, normaliseMobile } from '../src/modules/employees/data-form.schema.js';

/** A complete, valid submission — each test tweaks one field from this. */
const VALID = {
  firstName: 'سارة',
  fatherName: 'عبدالله',
  grandfatherName: 'محمد',
  lastName: 'العتيبي',
  nationalId: '1023456789',
  birthDateHijri: '1400-05-12',
  birthDate: '1980-03-29',
  gender: 'FEMALE',
  nationality: 'سعودي',
  maritalStatus: 'SINGLE',
  phone: '0551234567',
  email: 'sara@example.com',
  splAddress: 'RRRD2929',
  qualification: 'BACHELOR',
  major: 'محاسبة',
  iban: 'SA0380000000608010167519',
  emergencyContactName: 'نورة العتيبي',
  emergencyContactPhone: '0559876543',
};

describe('IBAN mod-97', () => {
  it('accepts a valid Saudi IBAN', () => {
    expect(isValidIban('SA0380000000608010167519')).toBe(true);
  });

  it('accepts the same IBAN with spaces and lowercase', () => {
    expect(isValidIban('sa03 8000 0000 6080 1016 7519')).toBe(true);
  });

  it('rejects a single mistyped digit — the whole point of the checksum', () => {
    expect(isValidIban('SA0380000000608010167518')).toBe(false);
  });

  it('rejects a transposition that a length check would miss', () => {
    expect(isValidIban('SA0380000000608010167591')).toBe(false);
  });

  it('rejects a non-Saudi IBAN', () => {
    expect(isValidIban('GB82WEST12345698765432')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidIban('SA038000000060801016751')).toBe(false);
  });
});

describe('mobile normalisation', () => {
  it.each([
    ['0551234567', '0551234567'],
    ['+966551234567', '0551234567'],
    ['966551234567', '0551234567'],
    ['055 123 4567', '0551234567'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseMobile(input)).toBe(expected);
  });
});

describe('dataFormSchema', () => {
  it('accepts a complete submission', () => {
    const parsed = dataFormSchema.parse(VALID);
    expect(parsed.firstName).toBe('سارة');
    expect(parsed.iban).toBe('SA0380000000608010167519');
  });

  it('normalises phone and uppercases the SPL address', () => {
    const parsed = dataFormSchema.parse({ ...VALID, phone: '+966551234567', splAddress: 'rrrd2929' });
    expect(parsed.phone).toBe('0551234567');
    expect(parsed.splAddress).toBe('RRRD2929');
  });

  it('rejects every field being absent — all 17 are mandatory', () => {
    const result = dataFormSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      // birthDateHijri is the only optional field; the other 17 must complain.
      expect(result.error.issues.length).toBeGreaterThanOrEqual(17);
    }
  });

  it('accepts a submission without the optional Hijri date', () => {
    const { birthDateHijri: _omitted, ...withoutHijri } = VALID;
    expect(dataFormSchema.safeParse(withoutHijri).success).toBe(true);
  });

  it.each([
    ['nationalId', '3023456789', 'an ID starting with 3 is neither Saudi nor Iqama'],
    ['nationalId', '102345678', 'nine digits'],
    ['splAddress', 'RRR2929', 'three letters'],
    ['splAddress', 'RRRDD929', 'five letters'],
    ['phone', '0451234567', 'not an 05 mobile'],
    ['birthDateHijri', '2024-05-12', 'Gregorian year in the Hijri field'],
    ['birthDateHijri', '1400-13-12', 'month 13'],
    ['email', 'not-an-email', 'malformed address'],
    ['iban', 'SA0380000000608010167518', 'bad checksum'],
  ])('rejects %s = %s (%s)', (field, value) => {
    const result = dataFormSchema.safeParse({ ...VALID, [field]: value });
    expect(result.success).toBe(false);
  });

  it.each(['firstName', 'fatherName', 'grandfatherName', 'lastName'])(
    'requires the %s part of the four-part name',
    (part) => {
      const result = dataFormSchema.safeParse({ ...VALID, [part]: '   ' });
      expect(result.success).toBe(false);
    },
  );

  it('rejects an unknown qualification', () => {
    const result = dataFormSchema.safeParse({ ...VALID, qualification: 'POSTDOC' });
    expect(result.success).toBe(false);
  });
});
