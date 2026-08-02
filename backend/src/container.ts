import { config } from './common/config.js';
import { prisma } from './common/prisma.js';
import { EventBus } from './events/event-bus.js';
import { TraineeRepository } from './modules/trainees/trainee.repository.js';
import { TraineeDocumentRepository } from './modules/trainees/trainee-document.repository.js';
import { ContractRepository } from './modules/trainees/contract.repository.js';
import { UserRepository } from './auth/user.repository.js';
import { AuditLogRepository } from './workflow/audit-log.repository.js';
import { SlaRuleRepository, HolidayRepository } from './workflow/sla-rule.repository.js';
import { NotificationRepository } from './notifications/notification.repository.js';
import { NotificationService } from './notifications/notification.service.js';
import { ConsoleNotifier } from './notifications/console.notifier.js';
import { SmtpNotifier } from './notifications/smtp.notifier.js';
import { buildTraineeWorkflow } from './workflow/trainee-workflow.js';
import { SlaScheduler } from './workflow/sla-scheduler.js';

/**
 * Composition root — the ONLY place where concrete implementations are
 * chosen and wired. Everything else receives its dependencies.
 */
export function buildContainer() {
  const trainees = new TraineeRepository(prisma);
  const documents = new TraineeDocumentRepository(prisma);
  const contracts = new ContractRepository(prisma);
  const users = new UserRepository(prisma);
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

  return {
    prisma,
    eventBus,
    repos: { trainees, documents, contracts, users, audit, slaRules, holidays, notificationRepo },
    notifications,
    traineeWorkflow,
    slaScheduler,
  };
}

export type Container = ReturnType<typeof buildContainer>;
