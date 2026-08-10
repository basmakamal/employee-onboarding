import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { config } from './config.js';

/**
 * Single PrismaClient for the whole process (Prisma 7: connection goes
 * through a driver adapter). Import this everywhere — never instantiate
 * PrismaClient ad hoc, or you leak connection pools.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(config.DATABASE_URL),
});

/**
 * What repositories accept: either the root client or a transaction client
 * (`prisma.$transaction(async (tx) => ...)`), so a service can run several
 * repository calls atomically by handing them the same `tx`.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A service's unit-of-work seam: run `fn` against a scope whose repositories
 * (and workflow, where relevant) are all bound to ONE database transaction —
 * everything inside commits or rolls back together.
 *
 * The container implements this with `prisma.$transaction`, rebuilding the
 * scope's repositories on the transaction client; tests implement it as
 * `(fn) => fn(fakes)` so the same fake repositories serve both paths.
 */
export type UnitOfWork<Scope> = <T>(fn: (scope: Scope) => Promise<T>) => Promise<T>;
