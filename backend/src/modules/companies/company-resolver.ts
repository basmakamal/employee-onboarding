import type { PrismaClient } from '../../generated/prisma/client.js';

const MAIN_CACHE_MS = 60_000;

/**
 * Answers "which company is this about?" for code that only holds a record
 * reference — a message about an employee, an asset form, an offboarding…
 * Each company has its own e-mail wording, mail server and automation, so
 * every message must know its company before it is rendered and sent.
 *
 * Mail that belongs to no company (a staff invitation, a password reset)
 * uses the MAIN company — the oldest one, i.e. the original single company.
 */
export class CompanyResolver {
  private main: { id: string | null; at: number } | null = null;

  constructor(private readonly db: PrismaClient) {}

  /** The oldest company — the default for anything that has no company of its own. */
  async mainCompanyId(): Promise<string | null> {
    if (this.main && Date.now() - this.main.at < MAIN_CACHE_MS) return this.main.id;
    const row = await this.db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    this.main = { id: row?.id ?? null, at: Date.now() };
    return this.main.id;
  }

  /** The given company, or the main one when there is none. */
  async orMain(companyId: string | null | undefined): Promise<string | null> {
    return companyId ?? (await this.mainCompanyId());
  }

  /** The company of the record a message or rule is about (null when unknown). */
  async ofRef(ref: { entity: string; entityId: string } | undefined): Promise<string | null> {
    if (!ref?.entityId) return null;
    const id = ref.entityId;
    const viaEmployee = { select: { employee: { select: { companyId: true } } } } as const;
    switch (ref.entity) {
      case 'EMPLOYEE':
        return (await this.db.employee.findUnique({ where: { id }, select: { companyId: true } }))?.companyId ?? null;
      case 'ASSET_FORM':
        return (await this.db.assetForm.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      case 'OFFBOARDING':
        return (await this.db.offboarding.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      case 'DOCUMENT_EXPIRY':
        return (await this.db.employeeDocument.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      case 'EMPLOYEE_REQUEST':
        return (await this.db.employeeRequest.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      case 'GOSI':
        return (await this.db.gosiProcess.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      case 'MEDICAL_INSURANCE':
        return (await this.db.medicalInsuranceProcess.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      case 'CRIMINAL_RECORD':
        return (await this.db.criminalRecordProcess.findUnique({ where: { id }, ...viaEmployee }))?.employee?.companyId ?? null;
      default:
        return null;
    }
  }
}
