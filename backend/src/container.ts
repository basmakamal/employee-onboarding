import { config } from './common/config.js';
import { prisma } from './common/prisma.js';
import { EventBus } from './events/event-bus.js';
import { TraineeRepository } from './modules/trainees/trainee.repository.js';
import { TraineeDocumentRepository } from './modules/trainees/trainee-document.repository.js';
import { ContractRepository } from './modules/trainees/contract.repository.js';
import { EmployeeRepository } from './modules/employees/employee.repository.js';
import { UserRepository } from './auth/user.repository.js';
import { LinkTokenRepository } from './auth/link-token.repository.js';
import { LinkTokenService } from './auth/link-token.service.js';
import { AuditLogRepository } from './workflow/audit-log.repository.js';
import { SlaRuleRepository, HolidayRepository } from './workflow/sla-rule.repository.js';
import { NotificationRepository } from './notifications/notification.repository.js';
import { NotificationService } from './notifications/notification.service.js';
import { SettingsService, DynamicNotifier } from './modules/settings/settings.service.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { buildTraineeWorkflow } from './workflow/trainee-workflow.js';
import { SlaScheduler } from './workflow/sla-scheduler.js';
import { SlaFiringRepository } from './workflow/sla-firing.repository.js';
import {
  traineeWatcher,
  offboardingWatcher,
  processWatcher,
  documentExpiryWatcher,
} from './workflow/sla-watchers.js';
import { EmployeeDocumentRepository } from './modules/employees/employee-document.repository.js';
import { OwnershipService } from './workflow/ownership.service.js';
import { TraineeService } from './modules/trainees/trainee.service.js';
import { EmployeeService } from './modules/employees/employee.service.js';
import { AssetRepository } from './modules/assets/asset.repository.js';
import { AssetFormRepository } from './modules/assets/asset-form.repository.js';
import { AssetService } from './modules/assets/asset.service.js';
import { OffboardingRepository } from './modules/offboarding/offboarding.repository.js';
import { OffboardingService } from './modules/offboarding/offboarding.service.js';
import { GosiRepository } from './modules/processes/gosi.repository.js';
import { MedicalInsuranceRepository } from './modules/processes/medical-insurance.repository.js';
import { CriminalRecordRepository } from './modules/processes/criminal-record.repository.js';
import { AuthService } from './auth/auth.service.js';

/**
 * Composition root — the ONLY place where concrete implementations are
 * chosen and wired. Everything else receives its dependencies.
 */
export function buildContainer() {
  const trainees = new TraineeRepository(prisma);
  const documents = new TraineeDocumentRepository(prisma);
  const contracts = new ContractRepository(prisma);
  const employees = new EmployeeRepository(prisma);
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
  const notifications = new NotificationService(notificationRepo, users, notifier);
  const dashboardService = new DashboardService(prisma);
  const reportsService = new ReportsService(prisma);

  const eventBus = new EventBus();
  const ownershipService = new OwnershipService(prisma);
  const traineeWorkflow = buildTraineeWorkflow({ trainees, documents, contracts, audit }, ownershipService);

  const employeeDocuments = new EmployeeDocumentRepository(prisma);
  const slaFirings = new SlaFiringRepository(prisma);
  const slaScheduler = new SlaScheduler(
    { rules: slaRules, holidays, firings: slaFirings, audit, notifications, calendar: settingsService },
    [
      traineeWatcher(trainees, traineeWorkflow),
      offboardingWatcher(new OffboardingRepository(prisma)),
      processWatcher('GOSI', gosi),
      processWatcher('MEDICAL_INSURANCE', medical),
      documentExpiryWatcher(employeeDocuments),
    ],
  );

  const authService = new AuthService(users, {
    access: config.JWT_ACCESS_SECRET,
    refresh: config.JWT_REFRESH_SECRET,
  });

  const linkTokenService = new LinkTokenService(linkTokens, config.APP_URL, config.LINK_TTL_HOURS);
  const traineeService = new TraineeService(
    { trainees, documents, contracts, employees, audit },
    traineeWorkflow,
    linkTokenService,
    notifications,
  );

  const employeeService = new EmployeeService(
    { employees, gosi, medical, criminal, audit },
    ownershipService,
  );

  const assets = new AssetRepository(prisma);
  const assetForms = new AssetFormRepository(prisma);
  const assetService = new AssetService(
    { assets, forms: assetForms, employees, audit },
    linkTokenService,
    notifications,
    ownershipService,
  );

  const offboardings = new OffboardingRepository(prisma);
  const offboardingService = new OffboardingService(
    { offboardings, employees, assetForms, audit },
    linkTokenService,
    notifications,
    ownershipService,
  );

  return {
    prisma,
    eventBus,
    repos: {
      trainees,
      documents,
      contracts,
      employees,
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
    traineeWorkflow,
    slaScheduler,
    linkTokenService,
    traineeService,
    employeeService,
    assetService,
    offboardingService,
    authService,
    settingsService,
    dashboardService,
    reportsService,
    ownershipService,
  };
}

export type Container = ReturnType<typeof buildContainer>;
