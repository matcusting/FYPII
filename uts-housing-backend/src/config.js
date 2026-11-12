import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 7),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  smtpUrl: process.env.SMTP_URL || '',
  emailFrom: process.env.EMAIL_FROM || 'no-reply@uts-housing.local',
  maxPhotosPerListing: 6,
  maxPhotoBytes: 5 * 1024 * 1024,
  staleListingDays: 30,
};
