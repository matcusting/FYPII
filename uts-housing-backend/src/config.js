import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT || 4000),
  // Render sets RENDER_EXTERNAL_URL automatically (frontend and API share one origin there).
  frontendOrigin: (process.env.FRONTEND_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 7),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  // Verification documents: never served statically, only through an access check.
  privateUploadDir: process.env.PRIVATE_UPLOAD_DIR || 'private-uploads',
  // 'disk' (default) or 'database' (hosts without a permanent disk). See services/storage.js.
  storageDriver: process.env.STORAGE_DRIVER === 'database' ? 'database' : 'disk',
  // Built React app to serve from the API (single-origin deployment). Empty = don't serve it.
  frontendDist: process.env.FRONTEND_DIST || '',
  maxDocumentBytes: 10 * 1024 * 1024,
  smtpUrl: process.env.SMTP_URL || '',
  emailFrom: process.env.EMAIL_FROM || 'no-reply@uts-housing.local',
  maxPhotosPerListing: 6,
  maxPhotoBytes: 5 * 1024 * 1024,
  staleListingDays: Number(process.env.STALE_LISTING_DAYS || 30),
  autoPauseListingDays: Number(process.env.AUTO_PAUSE_LISTING_DAYS || 45),
  jobIntervalMinutes: Number(process.env.JOB_INTERVAL_MINUTES || 60),
};
