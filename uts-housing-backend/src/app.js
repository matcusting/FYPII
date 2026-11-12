import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './db.js';
import { loadUser } from './middleware/auth.js';
import { originCheck } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import authRoutes from './modules/auth.js';
import profileRoutes from './modules/profile.js';
import metaRoutes from './modules/meta.js';
import listingRoutes, { favoritesRouter } from './modules/listings.js';
import roommateRoutes from './modules/roommates.js';
import conversationRoutes, { blocksRouter, inquiryRouter } from './modules/conversations.js';
import reviewRoutes, { listingReviewsRouter } from './modules/reviews.js';
import reportRoutes from './modules/reports.js';
import notificationRoutes from './modules/notifications.js';
import adminRoutes from './modules/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  // Only the known frontend origin may send credentialed requests (never "*").
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Health checks
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'error', database: 'down' });
    }
  });

  // Uploaded listing photos (random, unguessable file names)
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false, dotfiles: 'deny' }));

  const api = express.Router();
  api.use(originCheck);
  api.use(loadUser);
  api.use('/auth', authRoutes);
  api.use('/profile', profileRoutes);
  api.use('/meta', metaRoutes);
  api.use('/listings/:id/inquiries', inquiryRouter);
  api.use('/listings/:id/reviews', listingReviewsRouter);
  api.use('/listings', listingRoutes);
  api.use('/favorites', favoritesRouter);
  api.use('/roommates', roommateRoutes);
  api.use('/conversations', conversationRoutes);
  api.use('/blocks', blocksRouter);
  api.use('/reviews', reviewRoutes);
  api.use('/reports', reportRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/admin', adminRoutes);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
