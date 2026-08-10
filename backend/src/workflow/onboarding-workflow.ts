import type { Employee } from '../generated/prisma/client.js';
import { Workflow } from './engine.js';
import { onboardingMachine } from './machines/onboarding.machine.js';
import type { EmployeeRepository } from '../modules/employees/employee.repository.js';
import type { OnboardingDocumentRepository } from '../modules/employees/onboarding-document.repository.js';
import type { ContractRepository } from '../modules/employees/contract.repository.js';
import type { AuditLogRepository } from './audit-log.repository.js';
import type { EmployeeStatus } from '../generated/prisma/enums.js';

/**
 * Composition: the onboarding machine wired to real repositories.
 * Both the API services and the SLA scheduler drive transitions through
 * this single instance — one door, always guarded, always audited.
 */
export function buildOnboardingWorkflow(
  repos: {
    employees: EmployeeRepository;
    documents: OnboardingDocumentRepository;
    contracts: ContractRepository;
    audit: AuditLogRepository;
  },
  ownership?: import('./engine.js').OwnershipLookup,
): Workflow<Employee> {
  const machine = onboardingMachine({
    countMissingRequiredDocs: (employeeId) => repos.documents.countMissingRequired(employeeId),
    hasContract: async (employeeId) => (await repos.contracts.findByEmployee(employeeId)) !== null,
    contractWasSent: async (employeeId) =>
      (await repos.contracts.findByEmployee(employeeId))?.sentAt != null,
  });

  return new Workflow<Employee>(machine, {
    getId: (e) => e.id,
    getStatus: (e) => e.status,
    ...(ownership ? { ownership } : {}),
    move: (e, from, to) =>
      repos.employees.moveStatus(e.id, from as EmployeeStatus, to as EmployeeStatus),
    audit: (entry) => repos.audit.append(entry),
    anchors: (e) => ({ employeeId: e.id }),
  });
}
