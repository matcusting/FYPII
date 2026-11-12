import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { forbidden } from '../utils/http.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must
 * come from the configured frontend origin (or same origin). Combined with
 * SameSite=Lax cookies this blocks cross-site form posts.
 */
export function originCheck(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : null);
  if (!origin) return next(); // non-browser clients (curl, tests) send no Origin
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin === config.frontendOrigin || origin === self) return next();
  next(forbidden('Cross-site request blocked.'));
}

const limiter = (windowMin, max) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: config.isTest ? 10000 : max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } }),
  });

export const authLimiter = limiter(15, 20);
export const messageLimiter = limiter(1, 30);
export const writeLimiter = limiter(15, 60);
