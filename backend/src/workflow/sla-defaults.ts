import { SlaUnit, SlaAction } from '../generated/prisma/enums.js';

/**
 * The default automation rules every company starts with — the BRD table
 * (README §1) plus wider-coverage and escalation rules. The seed creates
 * them for each company, and a company added later gets them on creation.
 * After that each company tunes its own copy on the Automation page.
 */
export const DEFAULT_SLA_RULES: Array<{
  key: string;
  processKey?: string;
  status: string;
  afterValue: number;
  afterUnit: SlaUnit;
  action: SlaAction;
  notifySubject: boolean;
  notifyHr: boolean;
  notifyRole?: string;
  escalateToRole?: string;
}> = [
  {
    key: 'form-24h-reminder',
    status: 'AWAITING_FORM',
    afterValue: 24,
    afterUnit: SlaUnit.HOURS,
    action: SlaAction.REMIND,
    notifySubject: true,
    notifyHr: true,
  },
  {
    key: 'form-10d-expire',
    status: 'AWAITING_FORM',
    afterValue: 10,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.EXPIRE,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'contract-2wd-reminder',
    status: 'CONTRACT_CREATION',
    afterValue: 2,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'approval-5wd-daily',
    status: 'AWAITING_CONTRACT_APPROVAL',
    afterValue: 5,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND_DAILY,
    // Memo row 9: the trainee is reminded too, with a fresh contract link.
    notifySubject: true,
    notifyHr: true,
  },
  {
    key: 'approval-10d-expire',
    status: 'AWAITING_CONTRACT_APPROVAL',
    afterValue: 10,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.EXPIRE,
    notifySubject: false,
    notifyHr: true,
  },
  // Memo row 15: a custody form undecided for 24h — the employee and IT are reminded.
  {
    key: 'custody-24h-reminder-sent',
    processKey: 'ASSET_FORM',
    status: 'SENT',
    afterValue: 24,
    afterUnit: SlaUnit.HOURS,
    action: SlaAction.REMIND,
    notifySubject: true,
    notifyHr: true,
    notifyRole: 'IT',
  },
  {
    key: 'custody-24h-reminder-opened',
    processKey: 'ASSET_FORM',
    status: 'PENDING_EMPLOYEE_APPROVAL',
    afterValue: 24,
    afterUnit: SlaUnit.HOURS,
    action: SlaAction.REMIND,
    notifySubject: true,
    notifyHr: true,
    notifyRole: 'IT',
  },
  // Escalation: form still incomplete after 5 days despite reminders → ADMIN.
  {
    key: 'form-5d-escalate',
    status: 'AWAITING_FORM',
    afterValue: 5,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.ESCALATE,
    notifySubject: false,
    notifyHr: false,
    escalateToRole: 'ADMIN',
  },
  // Wider coverage: stalled offboardings and long-held process cards.
  {
    key: 'offboarding-assets-5wd',
    processKey: 'OFFBOARDING',
    status: 'ASSETS_PENDING',
    afterValue: 5,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'offboarding-settlement-5wd',
    processKey: 'OFFBOARDING',
    status: 'SETTLEMENT',
    afterValue: 5,
    afterUnit: SlaUnit.WORKING_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
    notifyRole: 'FINANCE',
  },
  {
    key: 'gosi-hold-14d',
    processKey: 'GOSI',
    status: 'ON_HOLD',
    afterValue: 14,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
    notifyRole: 'INSURANCE',
  },
  {
    key: 'medical-hold-14d',
    processKey: 'MEDICAL_INSURANCE',
    status: 'ON_HOLD',
    afterValue: 14,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
    notifyRole: 'INSURANCE',
  },
  // Document expiry — DEADLINE semantics: afterValue = days BEFORE expiry.
  {
    key: 'docs-any-30d-before',
    processKey: 'DOCUMENT_EXPIRY',
    status: 'ANY',
    afterValue: 30,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'docs-any-7d-daily',
    processKey: 'DOCUMENT_EXPIRY',
    status: 'ANY',
    afterValue: 7,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND_DAILY,
    notifySubject: false,
    notifyHr: true,
  },
  {
    key: 'contract-60d-before',
    processKey: 'DOCUMENT_EXPIRY',
    status: 'CONTRACT',
    afterValue: 60,
    afterUnit: SlaUnit.CALENDAR_DAYS,
    action: SlaAction.REMIND,
    notifySubject: false,
    notifyHr: true,
  },
];
