import type { Actor } from '../../workflow/engine.js';
import { GuardFailedError } from '../../workflow/errors.js';
import { pathInScope } from '../../auth/authz/scope.js';
import type { OrgPlacement } from './employee.repository.js';

/** The lookups placement validation needs — the employee repository provides them. */
export interface PlacementLookups {
  findOrgUnit(companyId: string, id: string): Promise<{ id: string; path: string; active: boolean; nameAr: string; nameEn: string } | null>;
  findPosition(companyId: string, id: string): Promise<{ id: string; active: boolean; titleAr: string; titleEn: string } | null>;
  findColleague(companyId: string, id: string): Promise<{ id: string; firstName: string; lastName: string } | null>;
}

export interface PlacementInput {
  orgUnitId?: string | null | undefined;
  positionId?: string | null | undefined;
  managerId?: string | null | undefined;
}

/**
 * Turn the ids a form sent into a validated placement inside the actor's
 * company. Every id is checked against the company (never trusted from the
 * client), the unit must sit inside the actor's own scope (a branch manager
 * cannot place someone in another branch), and inactive units / titles are
 * refused. The legacy text columns are mirrored from the chosen rows so
 * existing lists, filters and reports keep working until they are removed.
 *
 * Without a company on the actor (link / system / legacy callers) nothing is
 * validated and nothing is set — placement is a workspace feature.
 */
export async function resolvePlacement(
  lookups: PlacementLookups,
  actor: Actor,
  input: PlacementInput,
  options: { selfId?: string | undefined } = {},
): Promise<OrgPlacement & { department?: string; jobTitle?: string; directManager?: string }> {
  const companyId = actor.companyId;
  if (!companyId) return {};
  const out: OrgPlacement & { department?: string; jobTitle?: string; directManager?: string } = { companyId };

  if (input.orgUnitId !== undefined) {
    if (input.orgUnitId === null) out.orgUnitId = null;
    else {
      const unit = await lookups.findOrgUnit(companyId, input.orgUnitId);
      if (!unit) throw new GuardFailedError('BAD_ORG_UNIT', 'please select a valid branch or department of this company', 'orgUnitId');
      if (!unit.active) throw new GuardFailedError('BAD_ORG_UNIT', 'that branch or department is inactive', 'orgUnitId');
      const scope = actor.scope ?? { companyId, all: true, orgUnitPaths: [] };
      if (!pathInScope(scope, unit.path)) {
        throw new GuardFailedError('OUT_OF_SCOPE', 'you can only place people inside your own branch or department', 'orgUnitId');
      }
      out.orgUnitId = unit.id;
      out.department = unit.nameEn;
    }
  }

  if (input.positionId !== undefined) {
    if (input.positionId === null) out.positionId = null;
    else {
      const position = await lookups.findPosition(companyId, input.positionId);
      if (!position) throw new GuardFailedError('BAD_POSITION', 'please select a valid job title of this company', 'positionId');
      if (!position.active) throw new GuardFailedError('BAD_POSITION', 'that job title is inactive', 'positionId');
      out.positionId = position.id;
      out.jobTitle = position.titleEn;
    }
  }

  if (input.managerId !== undefined) {
    if (input.managerId === null) out.managerId = null;
    else {
      if (options.selfId && input.managerId === options.selfId) {
        throw new GuardFailedError('BAD_MANAGER', 'an employee cannot be their own manager', 'managerId');
      }
      const manager = await lookups.findColleague(companyId, input.managerId);
      if (!manager) throw new GuardFailedError('BAD_MANAGER', 'please select a valid manager from this company', 'managerId');
      out.managerId = manager.id;
      out.directManager = `${manager.firstName} ${manager.lastName}`.trim();
    }
  }
  return out;
}
