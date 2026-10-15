import { Router } from 'express';
import { asyncHandler } from '../../common/http.js';
import { readinessOf } from './readiness.js';

/** /api/employees/:id/readiness — "ready to work and be paid?", the checklist the employee file shows. */
export function readinessRouter(
  /** Loads what the readiness checklist needs. */
  readinessSource: (employeeId: string) => Promise<Parameters<typeof readinessOf>[0] | null>,
): Router {
  const router = Router();
  router.get(
    '/:id/readiness',
    asyncHandler(async (req, res) => {
      const input = await readinessSource(req.params['id'] as string);
      if (!input) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'employee not found' } });
        return;
      }
      res.json(readinessOf(input));
    }),
  );
  return router;
}
