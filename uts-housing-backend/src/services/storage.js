/**
 * Where uploaded files live.
 *
 *  - STORAGE_DRIVER=disk (default): files stay in UPLOAD_DIR (photos) and
 *    PRIVATE_UPLOAD_DIR (verification documents), as written by multer.
 *  - STORAGE_DRIVER=database: after validation the file content is moved into the
 *    StoredFile table and the temporary file is deleted. Used on hosts without a
 *    permanent disk (e.g. Render's free plan), so files survive restarts.
 *
 * Buckets: 'public' = listing photos, 'private' = verification documents.
 * Private files are still only served through the access-checked documents route.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { prisma } from '../db.js';

export const usesDatabase = () => config.storageDriver === 'database';
const dirFor = (bucket) => (bucket === 'private' ? config.privateUploadDir : config.uploadDir);
const keyOf = (file) => path.basename(file.path);

/** Keep validated multer uploads. In database mode the temp files are moved into Postgres. */
export async function saveUploads(bucket, files) {
  if (!usesDatabase() || !files.length) return;
  const rows = await Promise.all(
    files.map(async (f) => ({ objectKey: keyOf(f), bucket, mimeType: f.mimetype, sizeBytes: f.size, data: await fs.promises.readFile(f.path) })),
  );
  await prisma.storedFile.createMany({ data: rows });
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}

/** Throw away uploads after an error (temp files and anything already stored). */
export async function discardUploads(bucket, files) {
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
  if (usesDatabase() && files.length) await prisma.storedFile.deleteMany({ where: { bucket, objectKey: { in: files.map(keyOf) } } }).catch(() => {});
}

/** Write a file from memory (used by the demo seed). */
export async function saveBuffer(bucket, objectKey, data, mimeType) {
  if (usesDatabase()) {
    await prisma.storedFile.create({ data: { objectKey, bucket, mimeType, sizeBytes: data.length, data } });
    return;
  }
  fs.mkdirSync(dirFor(bucket), { recursive: true });
  fs.writeFileSync(path.join(dirFor(bucket), objectKey), data);
}

/** Read a stored file: { data, mimeType } or null when it is missing. */
export async function readStored(bucket, objectKey) {
  if (usesDatabase()) {
    const row = await prisma.storedFile.findUnique({ where: { objectKey } });
    return row && row.bucket === bucket ? { data: Buffer.from(row.data), mimeType: row.mimeType } : null;
  }
  const file = path.join(dirFor(bucket), path.basename(objectKey));
  if (!fs.existsSync(file)) return null;
  return { data: await fs.promises.readFile(file), mimeType: null };
}

/** Delete stored files by key (missing ones are ignored). */
export async function removeStored(bucket, objectKeys) {
  if (!objectKeys.length) return;
  if (usesDatabase()) {
    await prisma.storedFile.deleteMany({ where: { bucket, objectKey: { in: objectKeys } } }).catch(() => {});
    return;
  }
  for (const k of objectKeys) fs.rm(path.join(dirFor(bucket), path.basename(k)), { force: true }, () => {});
}
