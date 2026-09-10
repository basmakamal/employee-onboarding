import type { TemplateParams } from './templates.js';

/**
 * Contract terms as email placeholders.
 *
 * HR types the terms into the contract form (salary, duration, start date,
 * platform reference); the contract document itself lives on the external
 * platform, so an email can only quote what was recorded here. Missing values
 * are left out entirely rather than sent as "null" — a template that mentions
 * {{contractSalary}} for a contract with no salary simply renders nothing
 * there.
 */
export interface ContractLike {
  externalRef?: string | null;
  details?: unknown;
}

/** YYYY-MM-DD, whatever the stored value looks like (Date, ISO string, plain). */
function asDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || undefined;
  return d.toISOString().slice(0, 10);
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

export function contractParams(contract: ContractLike | null | undefined): TemplateParams {
  if (!contract) return {};
  const details = (contract.details ?? {}) as Record<string, unknown>;

  const salary = text(details['salary']);
  const duration = text(details['durationMonths']);
  const startDate = asDate(details['startDate']);
  const terms = text(details['terms']);
  const ref = text(contract.externalRef);

  // End date is derived, never stored: start + duration, minus a day so a
  // 12-month contract starting 01-01 ends 12-31 rather than the next 01-01.
  let endDate: string | undefined;
  const months = Number(duration);
  if (startDate && Number.isFinite(months) && months > 0) {
    const d = new Date(`${startDate}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCMonth(d.getUTCMonth() + months);
      d.setUTCDate(d.getUTCDate() - 1);
      endDate = d.toISOString().slice(0, 10);
    }
  }

  return {
    ...(salary ? { contractSalary: salary } : {}),
    ...(duration ? { contractDuration: duration } : {}),
    ...(startDate ? { contractStartDate: startDate } : {}),
    ...(endDate ? { contractEndDate: endDate } : {}),
    ...(terms ? { contractTerms: terms } : {}),
    ...(ref ? { contractRef: ref } : {}),
  };
}
