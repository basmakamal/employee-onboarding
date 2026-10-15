/**
 * The approvals inbox: only approvers may open it, each sees only the kinds
 * they may decide and only the people in their scope, oldest request first.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { approvalsRouter } from '../src/modules/workforce/approvals.routes.js';
import { errorHandler } from '../src/common/http.js';
import type { Actor } from '../src/workflow/engine.js';

const d = (s: string) => new Date(s);
const EMP = { id: 'e1', firstName: 'Omar', lastName: 'Saleh', employeeNo: 'EMP-1', orgUnit: null };

function fakeDb() {
  return {
    leaveRequest: {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue([
        { id: 'l1', employeeId: 'e1', leaveTypeId: 't1', employee: EMP, createdAt: d('2026-10-14T09:00:00Z'), status: 'PENDING', requestedById: 'u-hr', decidedById: null, decidedAt: null, decisionNote: null, reason: null,
          startDate: d('2026-10-18'), endDate: d('2026-10-20'), halfDay: false, days: '3', payBreakdown: [], leaveType: { code: 'ANNUAL', nameAr: 'س', nameEn: 'Annual', color: null, balanceMode: 'ACCRUAL' } },
      ]),
    },
    overtimeRequest: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        { id: 'o1', employeeId: 'e1', employee: EMP, createdAt: d('2026-10-13T09:00:00Z'), status: 'PENDING', requestedById: 'u-hr', decidedById: null, decidedAt: null, decisionNote: null, reason: 'release', date: d('2026-10-11'), minutes: 15, approvedMinutes: null },
      ]),
    },
    leaveLedgerEntry: { groupBy: vi.fn().mockResolvedValue([{ employeeId: 'e1', leaveTypeId: 't1', _sum: { days: '10' } }]) },
    attendanceDay: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u-hr', name: 'HR Officer' }]) },
    company: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Riyadh' }) },
  };
}

function app(db: ReturnType<typeof fakeDb>, actor: Actor) {
  const a = express();
  a.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  a.use('/api/approvals', approvalsRouter(db as never));
  a.use(errorHandler);
  return a;
}

const manager = (permissions: string[], orgUnitPaths: string[] = []): Actor => ({
  type: 'USER',
  id: 'u-mgr',
  companyId: 'co',
  permissions,
  scope: { companyId: 'co', all: orgUnitPaths.length === 0, orgUnitPaths },
});

describe('approvals inbox', () => {
  it('is closed to people who approve nothing', async () => {
    const res = await request(app(fakeDb(), manager(['employees.read']))).get('/api/approvals');
    expect(res.status).toBe(403);
  });

  it('lists leave and overtime together, oldest first, with the leave balance', async () => {
    const res = await request(app(fakeDb(), manager(['leave.approve', 'attendance.approve']))).get('/api/approvals');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { kind: string }) => i.kind)).toEqual(['OVERTIME', 'LEAVE']);
    expect(res.body.items[1].leave).toMatchObject({ days: 3, balance: 10 });
    expect(res.body.items[0].requestedBy).toBe('HR Officer');
  });

  it('shows only the kinds the actor may decide', async () => {
    const db = fakeDb();
    const res = await request(app(db, manager(['attendance.approve']))).get('/api/approvals');
    expect(res.body.items.map((i: { kind: string }) => i.kind)).toEqual(['OVERTIME']);
    expect(db.leaveRequest.findMany).not.toHaveBeenCalled();
  });

  it("a branch manager's queue is limited to their branches", async () => {
    const db = fakeDb();
    await request(app(db, manager(['leave.approve'], ['/u-riyadh/']))).get('/api/approvals/count');
    expect(db.leaveRequest.count).toHaveBeenCalledWith({
      where: { companyId: 'co', status: 'PENDING', employee: { companyId: 'co', OR: [{ orgUnit: { path: { startsWith: '/u-riyadh/' } } }] } },
    });
  });

  it('"decided" shows what this approver decided', async () => {
    const db = fakeDb();
    await request(app(db, manager(['leave.approve']))).get('/api/approvals?view=DECIDED');
    expect(db.leaveRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ decidedById: 'u-mgr' }) }));
  });
});
