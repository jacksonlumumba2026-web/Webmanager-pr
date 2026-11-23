import crypto from 'node:crypto';

const runtimeFallbackKey = crypto.randomBytes(32);

function getSessionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) {
    return crypto.createHash('sha256').update(secret).digest();
  }
  return runtimeFallbackKey;
}

function getEncryptionKey(): Buffer {
  const secret = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) {
    return crypto.createHash('sha256').update(secret).digest();
  }
  return runtimeFallbackKey;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedBuffer = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedBuffer.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedBuffer);
}

export interface SessionTokenPayload {
  profileId: string;
  email: string;
  exp: number;
}

export function signSessionToken(profileId: string, email: string, ttlSeconds = 60 * 60 * 12): string {
  const payload: SessionTokenPayload = {
    profileId,
    email,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionKey()).update(data).digest('base64url');
  return `wm_${data}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  if (!token.startsWith('wm_')) return null;
  const raw = token.slice(3);
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getSessionKey()).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!parsed.profileId || !parsed.email || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload');
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function generateInviteToken(): string {
  return crypto.randomBytes(24).toString('hex');
}
