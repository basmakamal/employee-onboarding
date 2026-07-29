import type { Db } from '../../common/prisma.js';
import type { ReviewOutcome } from '../../generated/prisma/enums.js';

export interface CreateReviewData {
  employeeId: string;
  reviewerId: string;
  outcome: ReviewOutcome;
  notes?: string;
}

export class ReviewRepository {
  constructor(private readonly db: Db) {}

  create(data: CreateReviewData) {
    return this.db.review.create({ data });
  }

  listByEmployee(employeeId: string) {
    return this.db.review.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
