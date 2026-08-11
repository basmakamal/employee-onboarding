/** One manual retention pass — for setups without Redis/worker. */
import { prisma } from '../src/common/prisma.js';
import { RetentionService } from '../src/maintenance/retention.js';

const report = await new RetentionService(prisma).run();
console.log(report);
await prisma.$disconnect();
