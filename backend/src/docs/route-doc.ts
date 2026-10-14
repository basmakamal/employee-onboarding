import type { ZodType } from 'zod';

/**
 * What a middleware tells the API documentation about the routes it guards.
 *
 * The OpenAPI (Swagger) spec is generated from the running app rather than
 * written by hand: the validation, permission and workspace middlewares tag
 * themselves with this note, and the generator reads the notes off every
 * route. A new route is therefore documented the moment it is mounted, and
 * the docs can never disagree with the code.
 */
export interface RouteDoc {
  /** JSON request body, validated by `validate(schema)`. */
  body?: ZodType;
  /** Query string, validated by `validateQuery(schema)`. */
  query?: ZodType;
  /** Any one of these permissions lets the request through. */
  permissions?: string[];
  /** The route only works inside a selected company. */
  company?: boolean;
  /** A signed-in staff user (Bearer access token) is required. */
  auth?: boolean;
  /** multipart/form-data upload — the named file fields. */
  files?: string[];
}

const KEY = '__routeDoc';

/** Attach a documentation note to a middleware; returns the same function. */
export function documented<T extends object>(handler: T, doc: RouteDoc): T {
  Object.defineProperty(handler, KEY, { value: doc, enumerable: false });
  return handler;
}

/** The note a middleware carries, if any. */
export function docOf(handler: unknown): RouteDoc | undefined {
  return handler && typeof handler === 'function' ? (handler as unknown as Record<string, RouteDoc>)[KEY] : undefined;
}
