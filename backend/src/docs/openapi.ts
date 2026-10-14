import type { Express } from 'express';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { docOf, type RouteDoc } from './route-doc.js';

/**
 * Builds the OpenAPI 3 document (what Swagger UI shows) by walking every
 * route mounted on the Express app.
 *
 * For each route it reads the notes left by the middlewares in front of it
 * (see route-doc.ts): the request body / query schema (Zod → JSON Schema),
 * the permissions, whether a signed-in user and a selected company are
 * needed, and whether it takes a file upload. Nothing is listed by hand.
 */

// ── Express 4 internals (the router stack is not a public API, but stable) ──
interface Layer {
  name: string;
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
  keys: Array<{ name: string | number }>;
  route?: { path: string | RegExp | Array<string | RegExp>; methods: Record<string, boolean>; stack: Layer[] };
}

/** A middleware seen earlier on some level, with the level's base path. */
interface Guard {
  base: string;
  regexp: Layer['regexp'];
  doc: RouteDoc;
}

interface FoundRoute {
  method: string;
  path: string; // express style, e.g. /api/employees/:id
  docs: RouteDoc[];
  upload: boolean;
}

/** `/^\/users\/(?:([^\/]+?))\/assignments\/?(?=\/|$)/i` → `/users/:id/assignments` */
function mountPath(layer: Layer): string {
  if (layer.regexp.fast_slash) return '';
  let src = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '');
  // A parameter segment: `(?:\/([^/]+?))` (Express 4.21+) or `(?:([^\/]+?))` (older).
  let i = 0;
  const param = () => `:${String(layer.keys[i++]?.name ?? 'param')}`;
  src = src
    .replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)/g, () => `\\/${param()}`)
    .replace(/\(\?:\(\[\^\\?\/\]\+\?\)\)/g, param);
  return src.replace(/\\\//g, '/').replace(/\\-/g, '-').replace(/\\\./g, '.');
}

/** A concrete path a guard's regexp can be tested against (params filled in). */
const sample = (path: string) => path.replace(/:[A-Za-z0-9_]+/g, 'x');

function isRouter(layer: Layer): boolean {
  return layer.name === 'router' && Array.isArray(layer.handle.stack);
}

function walk(stack: Layer[], base: string, inherited: Guard[], out: FoundRoute[]): void {
  const guards = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        if (typeof p !== 'string') continue;
        const full = `${base}${p}`.replace(/\/+$/, '') || '/';
        const applicable = guards.filter((g) => {
          if (g.regexp.fast_slash) return full.startsWith(g.base);
          if (!full.startsWith(g.base)) return false;
          return g.regexp.test(sample(full.slice(g.base.length)) || '/');
        });
        const own = layer.route.stack.map((l) => docOf(l.handle)).filter((d): d is RouteDoc => !!d);
        const upload = layer.route.stack.some((l) => l.handle.name === 'multerMiddleware');
        for (const method of Object.keys(layer.route.methods)) {
          out.push({ method, path: full, docs: [...applicable.map((g) => g.doc), ...own], upload });
        }
      }
    } else if (isRouter(layer)) {
      walk(layer.handle.stack ?? [], `${base}${mountPath(layer)}`, guards, out);
    } else {
      const doc = docOf(layer.handle);
      if (doc) guards.push({ base, regexp: layer.regexp, doc });
    }
  }
}

/** Every mounted route of the app. */
export function listRoutes(app: Express): FoundRoute[] {
  const out: FoundRoute[] = [];
  const router = (app as unknown as { _router?: { stack: Layer[] } })._router;
  walk(router?.stack ?? [], '', [], out);
  // The docs themselves are not part of the API.
  return out.filter((r) => !r.path.startsWith('/api/docs'));
}

// ── OpenAPI ────────────────────────────────────────────────────────────────

const TAG_NAMES: Record<string, string> = {
  auth: 'Auth',
  link: 'Signed links (no account)',
  companies: 'Companies',
  roles: 'Roles & permissions',
  users: 'Staff users',
  employees: 'Employees',
  'employee-documents': 'Employee documents',
  offboardings: 'Offboarding',
  org: 'Organisation',
  reports: 'Reports',
  dashboard: 'Dashboard',
  settings: 'Settings',
  lists: 'Lists',
  notifications: 'Notifications & e-mail log',
  ai: 'AI assistant',
  'email-templates': 'E-mail templates',
  'email-triggers': 'E-mail triggers',
  assets: 'Assets',
  'asset-forms': 'Asset custody forms',
  events: 'Live events',
  health: 'Health',
  ready: 'Health',
};

function tagOf(path: string): string {
  const seg = path.split('/')[2] ?? 'other';
  return TAG_NAMES[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1);
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  const out = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
  delete out['$schema'];
  return out;
}

/** Turn a validated query object into individual query parameters. */
function queryParameters(schema: ZodType) {
  const json = jsonSchema(schema) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, prop]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: prop,
    ...(typeof prop['description'] === 'string' ? { description: prop['description'] } : {}),
  }));
}

function describe(docs: RouteDoc[], upload: boolean): string {
  const lines: string[] = [];
  const auth = docs.some((d) => d.auth);
  const company = docs.some((d) => d.company);
  const permissionSets = docs.filter((d) => d.permissions?.length).map((d) => d.permissions!.join(' or '));
  if (!auth) lines.push('No staff sign-in needed.');
  if (permissionSets.length) lines.push(`**Permission:** ${permissionSets.join(', and ')}.`);
  if (company) lines.push('**Works inside the selected company** (choose one with `POST /api/auth/company`).');
  if (upload) lines.push('Upload: `multipart/form-data`.');
  return lines.join('\n\n');
}

const ERROR_RESPONSE = { $ref: '#/components/responses/Error' };

export function buildOpenApi(app: Express, info: { title: string; version: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  const routes = listRoutes(app).sort((a, b) => a.path.localeCompare(b.path));

  for (const route of routes) {
    const openPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const pathParams = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const body = route.docs.find((d) => d.body)?.body;
    const query = route.docs.find((d) => d.query)?.query;
    const auth = route.docs.some((d) => d.auth);
    const tag = tagOf(route.path);

    const operation: Record<string, unknown> = {
      tags: [tag],
      summary: `${route.method.toUpperCase()} ${route.path.replace(/^\/api/, '')}`,
      operationId: `${route.method}_${route.path.replace(/^\/api\//, '').replace(/[^A-Za-z0-9]+/g, '_')}`,
      description: describe(route.docs, route.upload),
      parameters: [...pathParams, ...(query ? queryParameters(query) : [])],
      responses: {
        '200': { description: 'OK' },
        ...(route.method === 'post' ? { '201': { description: 'Created' } } : {}),
        ...(route.method === 'delete' ? { '204': { description: 'Deleted' } } : {}),
        '400': ERROR_RESPONSE,
        ...(auth ? { '401': ERROR_RESPONSE, '403': ERROR_RESPONSE } : {}),
        '404': ERROR_RESPONSE,
      },
      security: auth ? [{ bearerAuth: [] }] : [],
    };
    if (body) {
      operation['requestBody'] = { required: true, content: { 'application/json': { schema: jsonSchema(body) } } };
    } else if (route.upload) {
      operation['requestBody'] = {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              description: 'The file field(s) plus any text fields the endpoint reads.',
              additionalProperties: true,
              properties: { file: { type: 'string', format: 'binary' } },
            },
          },
        },
      };
    }
    paths[openPath] = { ...(paths[openPath] ?? {}), [route.method]: operation };
  }

  const tags = [...new Set(routes.map((r) => tagOf(r.path)))].sort().map((name) => ({ name }));

  return {
    openapi: '3.0.3',
    info: {
      title: info.title,
      version: info.version,
      description: [
        'Every endpoint of the HR system, generated from the code.',
        '',
        '**How to try a staff endpoint:**',
        '1. `POST /api/auth/login` with your e-mail and password → copy `accessToken` from the response.',
        '2. Click **Authorize** (top right) and paste the token.',
        '3. Company data (employees, lists, settings…) needs a selected company: `POST /api/auth/company` with `{ "companyId": "…" }` once.',
        '',
        'Access tokens are short-lived — log in again when calls start returning 401.',
        'Errors always look like `{ "error": { "code", "message", "details"?: [...] } }`.',
      ].join('\n'),
    },
    servers: [{ url: '/' }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    properties: {
                      code: { type: 'string', example: 'VALIDATION_ERROR' },
                      message: { type: 'string' },
                      details: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            path: { type: 'string' },
                            code: { type: 'string' },
                            message: { type: 'string' },
                            params: { type: 'object', additionalProperties: true },
                          },
                        },
                      },
                    },
                    required: ['code', 'message'],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
