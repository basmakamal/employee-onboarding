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
