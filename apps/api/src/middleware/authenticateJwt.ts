import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';

export function authenticateJwt(req: Request, _res: Response, next: NextFunction): void {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError('Missing bearer token', 401, 'UNAUTHORIZED'));
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      ...(payload.workspaceRole ? { workspaceRole: payload.workspaceRole } : {})
    };
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
  }
}
