/**
 * Lists over HTTP: staff read the SELECTED company's lists; the public data
 * form reads the lists of the company its signed link belongs to.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { listsRouter } from '../src/modules/lists/lists.routes.js';
import { linkRouter } from '../src/modules/employees/link.routes.js';
import { NotFoundError } from '../src/workflow/errors.js';

function fakeLists() {
  return {
    all: vi.fn(async (companyId: string) => [{ key: 'GENDER', companyId }]),
    create: vi.fn(async (companyId: string, key: string, body: object) => ({ id: 'v1', companyId, list: key, ...body })),
    forPublicForm: vi.fn(async (companyId: string | null) => [{ key: 'NATIONALITY', companyId }]),
  };
}

describe('staff lists', () => {
  it('reads and writes the selected company only', async () => {
    const lists = fakeLists();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: 'USER', id: 'u1', role: 'ADMIN', permissions: ['lists.manage'],
        companyId: 'c-tabby', scope: { companyId: 'c-tabby', all: true, orgUnitPaths: [] },
      };
      next();
    });
    app.use('/lists', listsRouter(lists as never));
    app.use(errorHandler);

    const read = await request(app).get('/lists');
    expect(read.status).toBe(200);
    expect(lists.all).toHaveBeenCalledWith('c-tabby');

    const add = await request(app).post('/lists/ASSET_TYPE/values').send({ labelAr: 'طابعة', labelEn: 'Printer' });
    expect(add.status).toBe(201);
    expect(lists.create).toHaveBeenCalledWith('c-tabby', 'ASSET_TYPE', expect.objectContaining({ labelEn: 'Printer' }));
  });
});

describe('data form lists', () => {
  function app(employee: { companyId: string | null } | null) {
    const lists = fakeLists();
    const links = {
      verify: vi.fn(async (raw: string) => {
        if (raw !== 'good-token') throw new NotFoundError('link', 'expired or invalid');
        return { purpose: 'DATA_FORM', employee };
      }),
    };
    const a = express();
    a.use('/link', linkRouter({} as never, {} as never, {} as never, links as never, lists as never));
    a.use(errorHandler);
    return { a, lists };
  }

  it("serves the lists of the new hire's company", async () => {
    const { a, lists } = app({ companyId: 'c-riyada' });
    const res = await request(a).get('/link/good-token/lists');
    expect(res.status).toBe(200);
    expect(lists.forPublicForm).toHaveBeenCalledWith('c-riyada');
    expect(res.body.lists[0]).toMatchObject({ key: 'NATIONALITY', companyId: 'c-riyada' });
  });

  it('refuses an invalid or expired link', async () => {
    const { a, lists } = app({ companyId: 'c-riyada' });
    const res = await request(a).get('/link/bad-token/lists');
    expect(res.status).toBe(404);
    expect(lists.forPublicForm).not.toHaveBeenCalled();
  });
});
