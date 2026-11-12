import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// Argon2id parameters (OWASP baseline: m=19MiB, t=2, p=1)
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 };

export const hashPassword = (pw) => hash(pw, ARGON_OPTS);
export const verifyPassword = async (hashStr, pw) => {
  try { return await verify(hashStr, pw); } catch { return false; }
};

/** Opaque random token for cookies / e-mail links. Only its SHA-256 hash is stored. */
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A small list of extremely common passwords rejected at sign-up.
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwerty123',
  '11111111', 'iloveyou', 'abc12345', 'admin123', 'letmein1', 'welcome1', 'sunshine', '1q2w3e4r']);
export const isCommonPassword = (pw) => COMMON.has(pw.toLowerCase());
