import { config } from './common/config.js';
import { prisma, type Db, type UnitOfWork } from './common/prisma.js';
import { EventBus } from './events/event-bus.js';
import { EmployeeRepository } from './modules/employees/employee.repository.js';
import { OnboardingDocumentRepository } from './modules/employees/onboarding-document.repository.js';
import { ContractRepository } from './modules/employees/contract.repository.js';
import { EmployeeRequestRepository } from './modules/employees/employee-request.repository.js';
import { UserRepository } from './auth/user.repository.js';
import { LinkTokenRepository } from './auth/link-token.repository.js';
import { LinkTokenService } from './auth/link-token.service.js';
import { AuditLogRepository } from './workflow/audit-log.repository.js';
import { SlaRuleRepository, HolidayRepository } from './workflow/sla-rule.repository.js';
import { NotificationRepository } from './notifications/notification.repository.js';
import { NotificationService } from './notifications/notification.service.js';
import { SettingsService, DynamicNotifier } from './modules/settings/settings.service.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { WorkService } from './modules/work/work.service.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { AiService } from './ai/ai.service.js';
import { buildOnboardingWorkflow } from './workflow/onboarding-workflow.js';
import { SlaScheduler } from './workflow/sla-scheduler.js';
import { SlaFiringRepository } from './workflow/sla-firing.repository.js';
import {
  onboardingWatcher,
  offboardingWatcher,
  processWatcher,
  documentExpiryWatcher,
} from './workflow/sla-watchers.js';
import { EmployeeDocumentRepository } from './modules/employees/employee-document.repository.js';
import { OwnershipService } from './workflow/ownership.service.js';
import { OnboardingService, type OnboardingTxScope } from './modules/employees/onboarding.service.js';
import { EmployeeService, type EmployeeTxScope } from './modules/employees/employee.service.js';
import { AssetRepository } from './modules/assets/asset.repository.js';
import { AssetFormRepository } from './modules/assets/asset-form.repository.js';
import { AssetService, type AssetTxScope } from './modules/assets/asset.service.js';
import { OffboardingRepository } from './modules/offboarding/offboarding.repository.js';
import { OffboardingService, type OffboardingTxScope } from './modules/offboarding/offboarding.service.js';
import { GosiRepository } from './modules/processes/gosi.repository.js';
import { MedicalInsuranceRepository } from './modules/processes/medical-insurance.repository.js';
import { CriminalRecordRepository } from './modules/processes/criminal-record.repository.js';
import { AuthService } from './auth/auth.service.js';
import { RedisRefreshTokenStore } from './auth/refresh-token.store.js';
import { getMailQueue, getSharedRedis, redisEnabled } from './common/queue.js';
import { publishNotify } from './notifications/realtime.js';

/**
 * Composition root — the ONLY place where concrete implementations are
 * chosen and wired. Everything else receives its dependencies.
 */
export function buildContainer() {
  const employees = new EmployeeRepository(prisma);
  const documents = new OnboardingDocumentRepository(prisma);
  const contracts = new ContractRepository(prisma);
  const employeeRequests = new EmployeeRequestRepository(prisma);
  const gosi = new GosiRepository(prisma);
  const medical = new MedicalInsuranceRepository(prisma);
  const criminal = new CriminalRecordRepository(prisma);
  const users = new UserRepository(prisma);
  const linkTokens = new LinkTokenRepository(prisma);
  const audit = new AuditLogRepository(prisma);
  const slaRules = new SlaRuleRepository(prisma);
  const holidays = new HolidayRepository(prisma);
  const notificationRepo = new NotificationRepository(prisma);

  // The notifier follows the admin's saved mail settings at send time
  // (console/gmail/microsoft/custom) — no restart needed after changes.
  const settingsService = new SettingsService(prisma);
  const notifier = new DynamicNotifier(settingsService);
  // With Redis, emails are queued and the worker delivers them (with
  // retries); without it they send inline exactly as before.
  const notifications = new NotificationService(
    notificationRepo,
    users,
    notifier,
    redisEnabled ? (job) => getMailQueue().add('send', job) : undefined,
    publishNotify,
  );
  const dashboardService = new DashboardService(prisma);
  const reportsService = new ReportsService(prisma);
  const aiService = new AiService(
    prisma,
    config.ANTHROPIC_API_KEY,
    config.AI_MODEL,
    config.AI_REDACT_PII,
  );

  const eventBus = new EventBus();
  const ownershipService = new OwnershipService(prisma);
  // The mobile queue reads the same ownership table the engine enforces.
  const workService = new WorkService(prisma, ownershipService, slaRules);
  const onboardingWorkflow = buildOnboardingWorkflow(
    { employees, documents, contracts, audit },
    ownershipService,
  );

  // ---------------------------------------------------------------- units of work
  // Each service's `transact` rebuilds its scope on the transaction client,
  // so a transition, its audit row, its stamps and the consumed link all
  // commit — or roll back — together. Repositories are stateless, so
  // constructing them per transaction costs nothing.
  const unitOfWork =
    <S>(scope: (db: Db) => S): UnitOfWork<S> =>
    (fn) =>
      prisma.$transaction((tx) => fn(scope(tx)));

  const markLinkUsedWith = (db: Db) => (tokenId: string, at: Date) =>
    new LinkTokenRepository(db).markUsed(tokenId, at);

  const onboardingScope = (db: Db): OnboardingTxScope => {
    const scoped = {
      employees: new EmployeeRepository(db),
      documents: new OnboardingDocumentRepository(db),
      contracts: new ContractRepository(db),
      audit: new AuditLogRepository(db),
    };
    return {
      ...scoped,
      workflow: buildOnboardingWorkflow(scoped, ownershipService),
      markLinkUsed: markLinkUsedWith(db),
    };
  };

  const employeeScope = (db: Db): EmployeeTxScope => ({
    employees: new EmployeeRepository(db),
    requests: new EmployeeRequestRepository(db),
    gosi: new GosiRepository(db),
    medical: new MedicalInsuranceRepository(db),
    criminal: new CriminalRecordRepository(db),
    audit: new AuditLogRepository(db),
  });

  const assetScope = (db: Db): AssetTxScope => ({
    forms: new AssetFormRepository(db),
    audit: new AuditLogRepository(db),
    markLinkUsed: markLinkUsedWith(db),
  });

  const offboardingScope = (db: Db): OffboardingTxScope => ({
    offboardings: new OffboardingRepository(db),
    employees: new EmployeeRepository(db),
    assetForms: new AssetFormRepository(db),
    audit: new AuditLogRepository(db),
    markLinkUsed: markLinkUsedWith(db),
  });

  const employeeDocuments = new EmployeeDocumentRepository(prisma);
  const slaFirings = new SlaFiringRepository(prisma);
  const slaScheduler = new SlaScheduler(
    { rules: slaRules, holidays, firings: slaFirings, audit, notifications, calendar: settingsService },
    [
      onboardingWatcher(employees, onboardingWorkflow),
      offboardingWatcher(new OffboardingRepository(prisma)),
      processWatcher('GOSI', gosi),
      processWatcher('MEDICAL_INSURANCE', medical),
      documentExpiryWatcher(employeeDocuments),
    ],
  );

  const authService = new AuthService(
    users,
    {
      access: config.JWT_ACCESS_SECRET,
      refresh: config.JWT_REFRESH_SECRET,
    },
    // Refresh tokens become single-use + revocable when Redis is present.
    redisEnabled ? new RedisRefreshTokenStore(getSharedRedis()) : undefined,
  );

  const linkTokenService = new LinkTokenService(linkTokens, config.APP_URL, config.LINK_TTL_HOURS);
  const onboardingService = new OnboardingService(
    { employees, documents, contracts, audit },
    onboardingWorkflow,
    linkTokenService,
    notifications,
    unitOfWork(onboardingScope),
  );

  const employeeService = new EmployeeService(
    { employees, requests: employeeRequests, gosi, medical, criminal, audit },
    unitOfWork(employeeScope),
    ownershipService,
    onboardingWorkflow,
  );

  const assets = new AssetRepository(prisma);
  const assetForms = new AssetFormRepository(prisma);
  const assetService = new AssetService(
    { assets, forms: assetForms, employees, audit },
    linkTokenService,
    notifications,
    unitOfWork(assetScope),
    ownershipService,
  );

  const offboardings = new OffboardingRepository(prisma);
  const offboardingService = new OffboardingService(
    { offboardings, employees, assetForms, audit },
    linkTokenService,
    notifications,
    unitOfWork(offboardingScope),
    ownershipService,
  );

  return {
    prisma,
    eventBus,
    repos: {
      employees,
      documents,
      contracts,
      gosi,
      medical,
      criminal,
      users,
      linkTokens,
      audit,
      slaRules,
      slaFirings,
      holidays,
      employeeDocuments,
      notificationRepo,
    },
    notifications,
    notifier,
    onboardingWorkflow,
    slaScheduler,
    linkTokenService,
    onboardingService,
    employeeService,
    assetService,
    offboardingService,
    authService,
    settingsService,
    dashboardService,
    workService,
    reportsService,
    aiService,
    ownershipService,
  };
}

export type Container = ReturnType<typeof buildContainer>;
