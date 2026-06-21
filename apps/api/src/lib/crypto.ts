import crypto from 'node:crypto';
import { env } from '../config/env';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createKeyPair(prefixLabel: string): { plain: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('hex');
  const prefix = crypto.randomBytes(8).toString('hex');
  const plain = `${prefixLabel}_${prefix}.${secret}`;
  return {
    plain,
    prefix,
    hash: sha256(plain)
  };
}

const SOCIAL_KEY = env.socialCryptoKey ?? env.jwtAccessSecret;

function getAesKey(): Buffer {
  return crypto.createHash('sha256').update(SOCIAL_KEY).digest();
}

export function encryptString(plain: string): string {
  const iv = crypto.randomBytes(12);
  const key = getAesKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptString(enc: string): string {
  const data = Buffer.from(enc, 'base64');
  const iv = data.slice(0, 12);
  const tag = data.slice(12, 28);
  const encrypted = data.slice(28);
  const key = getAesKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
