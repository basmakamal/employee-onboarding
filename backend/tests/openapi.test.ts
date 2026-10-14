/**
 * The Swagger spec is generated from the mounted routes: every route shows
 * up with its path parameters, body schema, query parameters, permissions
 * and whether it needs a signed-in user and a selected company.
 */
import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { validate, validateQuery } from '../src/common/http.js';
import { requireCompany, requirePermission } from '../src/auth/authz/authorize.js';
import { documented } from '../src/docs/route-doc.js';
import { buildOpenApi, listRoutes } from '../src/docs/openapi.js';

function sampleApp() {
  const staff = Router();
  // Stand-in for requireAuth: a tagged no-op.
  staff.use(documented((_req: express.Request, _res: express.Response, next: express.NextFunction) => next(), { auth: true }));
  staff.use(['/employees'], requireCompany());

  const employees = Router();
  employees.get('/', validateQuery(z.object({ page: z.coerce.number().int().min(1).default(1), q: z.string().optional() })), (_req, res) => res.json([]));
  employees.post(
    '/',
    requirePermission('employees.write' as never),
    validate(z.object({ firstName: z.string().min(1), email: z.string().email() })),
    (_req, res) => res.status(201).json({}),
  );
  staff.use('/employees', employees);

  const assignments = Router();
  assignments.put('/', requirePermission('users.manage' as never), (_req, res) => res.json({}));
  staff.use('/users/:id/assignments', assignments);

  const link = Router();
  link.get('/:token', (_req, res) => res.json({}));

  return createApp({ staffRouter: staff, linkRouter: link, docs: { title: 'Test', version: '1' } });
}

/** Loose view of one generated operation — enough for the assertions below. */
interface Op {
  description: string;
  security: unknown[];
  parameters: Array<{ name: string; in: string; required?: boolean }>;
  requestBody: { content: Record<string, { schema: { required: string[]; properties: Record<string, { format?: string }> } }> };
}
const op = (spec: ReturnType<typeof buildOpenApi>, path: string, method: string) => spec.paths[path]![method] as Op;

describe('OpenAPI generation', () => {
  it('lists every mounted route with its full path', () => {
    const routes = listRoutes(sampleApp() as never).map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /api/employees',
        'POST /api/employees',
        'PUT /api/users/:id/assignments',
        'GET /api/link/:token',
      ]),
    );
    expect(routes.some((r) => r.includes('/api/docs'))).toBe(false);
  });

  it('documents bodies, query parameters, path parameters and access rules', () => {
    const spec = buildOpenApi(sampleApp() as never, { title: 'Test', version: '1' });
    const create = op(spec, '/api/employees', 'post');
    const schema = create.requestBody.content['application/json']!.schema;
    expect(schema.required).toEqual(expect.arrayContaining(['firstName', 'email']));
    expect(schema.properties['email']!.format).toBe('email');
    expect(create.description).toContain('employees.write');
    expect(create.description).toContain('selected company');
    expect(create.security).toEqual([{ bearerAuth: [] }]);

    const list = op(spec, '/api/employees', 'get');
    expect(list.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['page', 'q']));

    const assign = op(spec, '/api/users/{id}/assignments', 'put');
    expect(assign.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
    // requireCompany guards /employees only.
    expect(assign.description).not.toContain('selected company');

    expect(op(spec, '/api/link/{token}', 'get').security).toEqual([]);
  });

  it('serves the spec and the Swagger UI without a token', async () => {
    const app = sampleApp();
    const spec = await request(app).get('/api/docs/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toBe('3.0.3');
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
  });
});
