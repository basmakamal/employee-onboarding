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
import { ConsoleNotifier } from './notifications/console.notifier.js';
import { SmtpNotifier } from './notifications/smtp.notifier.js';
import { buildTraineeWorkflow } from './workflow/trainee-workflow.js';
import { SlaScheduler } from './workflow/sla-scheduler.js';
import { TraineeService } from './modules/trainees/trainee.service.js';
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
  const users = new UserRepository(prisma);
  const linkTokens = new LinkTokenRepository(prisma);
  const audit = new AuditLogRepository(prisma);
  const slaRules = new SlaRuleRepository(prisma);
  const holidays = new HolidayRepository(prisma);
  const notificationRepo = new NotificationRepository(prisma);

  const notifier = config.NOTIFIER === 'smtp' ? new SmtpNotifier(config) : new ConsoleNotifier();
  const notifications = new NotificationService(notificationRepo, users, notifier);

  const eventBus = new EventBus();
  const traineeWorkflow = buildTraineeWorkflow({ trainees, documents, contracts, audit });

  const slaScheduler = new SlaScheduler({
    rules: slaRules,
    holidays,
    trainees,
    workflow: traineeWorkflow,
    audit,
    notifications,
  });

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

  return {
    prisma,
    eventBus,
    repos: {
      trainees,
      documents,
      contracts,
      employees,
      users,
      linkTokens,
      audit,
      slaRules,
      holidays,
      notificationRepo,
    },
    notifications,
    traineeWorkflow,
    slaScheduler,
    linkTokenService,
    traineeService,
    authService,
  };
}

export type Container = ReturnType<typeof buildContainer>;
