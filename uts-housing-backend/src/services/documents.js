import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../utils/http.js';

/**
 * Private verification documents (offer letters, student cards, identity cards,
 * title deeds, tenancy agreements…).
 *
 *  - Stored in PRIVATE_UPLOAD_DIR, which is NOT served statically. Files are only
 *    returned by GET /api/v1/documents/:id after an access check (see canView).
 *  - Random file names; the original name is kept only for display.
 *  - Type is checked from the file's real signature (PDF / JPEG / PNG), not the
 *    browser-supplied MIME type. Size and count are limited.
 */

export const STUDENT_KINDS = ['OFFER_LETTER', 'STUDENT_CARD'];
export const LANDLORD_KINDS = ['IDENTITY_CARD', 'COMPANY_REGISTRATION'];
export const PROPERTY_KINDS = ['PROPERTY_TITLE', 'TENANCY_AGREEMENT', 'OWNER_AUTHORISATION', 'OTHER_PROPERTY'];

export const KIND_LABELS = {
  OFFER_LETTER: 'Offer letter',
  STUDENT_CARD: 'Student card photo',
  IDENTITY_CARD: 'Identity card (MyKad / passport)',
  COMPANY_REGISTRATION: 'Company registration (SSM)',
  PROPERTY_TITLE: 'Title deed / proof of ownership',
  TENANCY_AGREEMENT: 'Tenancy agreement',
  OWNER_AUTHORISATION: "Owner's authorisation letter",
  OTHER_PROPERTY: 'Other supporting document',
};

const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

fs.mkdirSync(config.privateUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: config.privateUploadDir,
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT[file.mimetype] || ''}`),
});

/** Multer middleware for the given fields, e.g. [{ name: 'offerLetter', maxCount: 1 }]. */
export function documentUpload(fields) {
  const m = multer({
    storage,
    limits: { fileSize: config.maxDocumentBytes, files: fields.reduce((n, f) => n + f.maxCount, 0) },
    fileFilter: (_req, file, cb) =>
      EXT[file.mimetype] ? cb(null, true) : cb(badRequest('Only PDF, JPG or PNG files are accepted.')),
  }).fields(fields);
  return (req, res) =>
    new Promise((resolve, reject) =>
      m(req, res, (err) => {
        if (!err) return resolve(req.files || {});
        if (err.code === 'LIMIT_FILE_SIZE') return reject(badRequest(`Each file must be ${config.maxDocumentBytes / 1024 / 1024} MB or smaller.`));
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return reject(badRequest('Too many files, or an unexpected file field.'));
        reject(err);
      }),
    );
}

/** Real file type from its first bytes: 'pdf' | 'jpg' | 'png' | null. */
export function sniff(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

export function removeFiles(files) {
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}

/**
 * Validate uploaded files and turn them into Document rows (not yet saved).
 * @param files  multer files
 * @param kind   DocumentKind
 * @param allow  allowed sniffed types, e.g. ['pdf'] or ['pdf','jpg','png']
 */
export function toDocumentRows(files, kind, ownerId, allow = ['pdf', 'jpg', 'png']) {
  return files.map((f) => {
    const type = sniff(f.path);
    if (!type || !allow.includes(type)) {
      const list = allow.map((t) => t.toUpperCase()).join(' or ');
      throw badRequest(`${KIND_LABELS[kind]}: "${f.originalname}" is not a valid ${list} file.`);
    }
    return {
      ownerId,
      kind,
      objectKey: path.basename(f.path),
      originalName: f.originalname.slice(0, 200),
      mimeType: MIME[type],
      sizeBytes: f.size,
    };
  });
}

export const documentPath = (doc) => path.join(config.privateUploadDir, doc.objectKey);

/** Shape returned to clients (never the storage key). */
export const serializeDocument = (d) => ({
  id: d.id,
  kind: d.kind,
  kindLabel: KIND_LABELS[d.kind],
  originalName: d.originalName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  createdAt: d.createdAt,
  url: `/api/v1/documents/${d.id}`,
});

/**
 * Who may open a document:
 *  - the person who uploaded it;
 *  - administrators (student verification is theirs; they may also inspect others);
 *  - legal reviewers, but only landlord-identity and property documents.
 */
export function canView(user, doc) {
  if (!user) return false;
  if (doc.ownerId === user.id) return true;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'LEGAL_REVIEWER') return LANDLORD_KINDS.includes(doc.kind) || PROPERTY_KINDS.includes(doc.kind);
  return false;
}
