import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: string;
  // Active workspace this token operates in, plus the member's role there.
  workspaceId?: string;
  workspaceRole?: string;
  typ: 'access';
};

export type RefreshTokenPayload = {
  sub: string;
  typ: 'refresh';
  jti: string;
};

// ★2026-08-12: opsiyonel `expiresIn` eklendi (varsayılan: env.jwtAccessExpiresIn = 2h).
// Gerekçe: yayın (stream) token'ı "short-lived" diye üretiliyordu ama oturum token'ıyla
// AYNI 2 saatlik ömre sahipti — sızarsa 2 saat boyunca TÜM REST yüzeyinde geçerli bir
// access token demekti. Çağıranın ömrü daraltabilmesi için parametre; imza geriye dönük
// uyumlu, mevcut çağrılar aynen 2h alır.
export function signAccessToken(payload: Omit<AccessTokenPayload, 'typ'>, expiresIn?: string): string {
  return jwt.sign({ ...payload, typ: 'access' }, env.jwtAccessSecret, {
    expiresIn: expiresIn ?? env.jwtAccessExpiresIn
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'refresh' }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
}
