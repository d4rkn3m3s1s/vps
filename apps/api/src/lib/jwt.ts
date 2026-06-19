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

export function signAccessToken(payload: Omit<AccessTokenPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'access' }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn
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
