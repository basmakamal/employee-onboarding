/**
 * Workflow engine unit tests — the generic executor, isolated with fakes.
 */
import { describe, expect, it, vi } from 'vitest';
import { Workflow, type EngineDeps, type MachineDef } from '../src/workflow/engine.js';
import {
  ForbiddenActorError,
  GuardFailedError,
  IllegalTransitionError,
  StaleTransitionError,
} from '../src/workflow/errors.js';

interface Rec {
  id: string;
  status: string;
}

function makeDeps(moveResult = true) {
  const audit = vi.fn().mockResolvedValue({});
  const move = vi.fn().mockResolvedValue(moveResult);
  const deps: EngineDeps<Rec> = {
    getId: (r) => r.id,
    getStatus: (r) => r.status,
    move,
    audit,
  };
  return { deps, audit, move };
}

const MACHINE: MachineDef<Rec> = {
  key: 'TEST',
  transitions: [
    { action: 'GO', from: 'A', to: 'B', actors: ['USER'] },
    {
      action: 'GUARDED',
      from: 'A',
      to: 'C',
      actors: ['USER'],
      guard: () => {
        throw new GuardFailedError('NOPE', 'blocked');
      },
    },
    { action: 'DYNAMIC', from: 'B', to: (ctx) => (ctx.record.id === 'x' ? 'X' : 'Y'), actors: ['SYSTEM'] },
  ],
};

describe('Workflow.transition', () => {
  it('runs a legal transition, persists it, and audits it', async () => {
    const { deps, audit, move } = makeDeps();
    const wf = new Workflow(MACHINE, deps);

    const result = await wf.transition({ id: 'r1', status: 'A' }, 'GO', {
      type: 'USER',
      id: 'u1',
    });

    expect(result).toEqual({ from: 'A', to: 'B', action: 'GO' });
    expect(move).toHaveBeenCalledWith({ id: 'r1', status: 'A' }, 'A', 'B');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'TEST',
        entityId: 'r1',
        action: 'GO',
        fromStatus: 'A',
        toStatus: 'B',
        actorType: 'USER',
        actorId: 'u1',
      }),
    );
  });

  it('rejects an action with no edge from the current status', async () => {
    const wf = new Workflow(MACHINE, makeDeps().deps);
    await expect(
      wf.transition({ id: 'r1', status: 'B' }, 'GO', { type: 'USER' }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('rejects a disallowed actor type even on a legal edge', async () => {
    const wf = new Workflow(MACHINE, makeDeps().deps);
    await expect(
      wf.transition({ id: 'r1', status: 'A' }, 'GO', { type: 'LINK' }),
    ).rejects.toBeInstanceOf(ForbiddenActorError);
  });

  it('propagates guard failures and does not persist or audit', async () => {
    const { deps, audit, move } = makeDeps();
    const wf = new Workflow(MACHINE, deps);

    await expect(
      wf.transition({ id: 'r1', status: 'A' }, 'GUARDED', { type: 'USER' }),
    ).rejects.toBeInstanceOf(GuardFailedError);
    expect(move).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('throws StaleTransition when the guarded move loses the race', async () => {
    const { deps, audit } = makeDeps(false);
    const wf = new Workflow(MACHINE, deps);

    await expect(
      wf.transition({ id: 'r1', status: 'A' }, 'GO', { type: 'USER' }),
    ).rejects.toBeInstanceOf(StaleTransitionError);
    expect(audit).not.toHaveBeenCalled();
  });

  it('resolves dynamic targets from the record', async () => {
    const { deps } = makeDeps();
    const wf = new Workflow(MACHINE, deps);

    const r1 = await wf.transition({ id: 'x', status: 'B' }, 'DYNAMIC', { type: 'SYSTEM' });
    const r2 = await wf.transition({ id: 'other', status: 'B' }, 'DYNAMIC', { type: 'SYSTEM' });

    expect(r1.to).toBe('X');
    expect(r2.to).toBe('Y');
  });

  it('lists available actions per status and actor — for UI buttons', () => {
    const wf = new Workflow(MACHINE, makeDeps().deps);
    expect(wf.availableActions('A', { type: 'USER', role: 'HR' })).toEqual(['GO', 'GUARDED']);
    expect(wf.availableActions('A', { type: 'LINK' })).toEqual([]);
    expect(wf.availableActions('B', { type: 'SYSTEM' })).toEqual(['DYNAMIC']);
  });
});
