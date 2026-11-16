import fs from 'node:fs';
import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound, parse, uuid } from '../utils/http.js';
import { canView, documentPath } from '../services/documents.js';
import { audit } from '../services/audit.js';

const router = Router();

// Open a private document. Anyone without access gets 404 (no hint that it exists).
router.get('/:id', requireAuth, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || !canView(req.user, doc)) throw notFound('Document not found.');
  const file = documentPath(doc);
  if (!fs.existsSync(file)) throw notFound('Document file is missing.');
  // Every time someone other than the uploader opens a document, record it.
  if (doc.ownerId !== req.user.id) await audit(req.user.id, 'DOCUMENT_VIEWED', 'Document', doc.id, { kind: doc.kind });

  const safeName = doc.originalName.replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Images are shown with scripts disabled. (A CSP sandbox would also block the
  // browser's built-in PDF viewer; PDFs are already checked by their signature.)
  if (doc.mimeType !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  fs.createReadStream(file).pipe(res);
});

export default router;
