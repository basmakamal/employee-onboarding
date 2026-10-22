import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import { NotFoundError } from '../../workflow/errors.js';
import type { EmployeeDocumentRepository } from './employee-document.repository.js';
import type { SlaFiringRepository } from '../../workflow/sla-firing.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { Actor } from '../../workflow/engine.js';

const documentSchema = z.object({
  type: z.string().min(1),
  number: z.string().optional(),
  expiryDate: z.coerce.date(),
  notes: z.string().optional(),
});

/** Expiry-tracked documents: nested list/create + flat update/delete. */
export function employeeDocumentRouter(deps: {
  documents: EmployeeDocumentRepository;
  firings: SlaFiringRepository;
  audit: AuditLogRepository;
}): { nested: Router; flat: Router } {
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  const auditDoc = (
    req: { actor?: Actor },
    action: string,
    doc: { id: string; employeeId: string; type: string; expiryDate: Date },
  ) =>
    deps.audit.append({
      entity: 'DOCUMENT_EXPIRY',
      entityId: doc.id,
      action,
      actorType: actor(req).type,
      ...(actor(req).id ? { actorId: actor(req).id } : {}),
      employeeId: doc.employeeId,
      metadata: { type: doc.type, expiryDate: doc.expiryDate.toISOString().slice(0, 10) },
    });

  // /api/employees/:id/documents
  const nested = Router({ mergeParams: true });

  nested.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await deps.documents.listByEmployee(req.params['id'] as string));
    }),
  );

  nested.post(
    '/',
    requireRole('HR', 'ADMIN'),
    validate(documentSchema),
    asyncHandler(async (req, res) => {
      const input = compact(req.body as z.infer<typeof documentSchema>);
      const doc = await deps.documents.create(req.params['id'] as string, input);
      await auditDoc(req, 'DOCUMENT_ADDED', doc);
      res.status(201).json(doc);
    }),
  );

  // /api/employee-documents/:docId
  const flat = Router();

  flat.put(
    '/:docId',
    requireRole('HR', 'ADMIN'),
    validate(documentSchema.partial()),
    asyncHandler(async (req, res) => {
      const id = req.params['docId'] as string;
      const existing = await deps.documents.findById(id);
      if (!existing) throw new NotFoundError('document', id);

      const input = compact(req.body as Partial<z.infer<typeof documentSchema>>);
      const doc = await deps.documents.update(id, input);

      // A renewed expiry date must alert again on its next cycle.
      if (input.expiryDate && input.expiryDate.getTime() !== existing.expiryDate.getTime()) {
        await deps.firings.clearForEntity(id);
        await auditDoc(req, 'DOCUMENT_RENEWED', doc);
      } else {
        await auditDoc(req, 'DOCUMENT_UPDATED', doc);
      }
      res.json(doc);
    }),
  );

  flat.delete(
    '/:docId',
    requireRole('HR', 'ADMIN'),
    asyncHandler(async (req, res) => {
      const id = req.params['docId'] as string;
      const existing = await deps.documents.findById(id);
      if (!existing) throw new NotFoundError('document', id);
      await deps.firings.clearForEntity(id);
      await deps.documents.remove(id);
      await auditDoc(req, 'DOCUMENT_REMOVED', existing);
      res.status(204).end();
    }),
  );

  return { nested, flat };
}
