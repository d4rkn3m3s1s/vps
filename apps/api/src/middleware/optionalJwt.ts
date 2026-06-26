import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/jwt';

// Populates req.auth IF a valid Bearer token is present, but never rejects.
// Used on read routes that are gated by the API key but should be workspace-scoped
// when an interactive (JWT) caller is present. Service calls (API key only) pass
// through with no workspace context and operate unscoped by design.
export function optionalJwt(req: Request, _res: Response, next: NextFunction): void {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next();
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
  } catch {
    /* ignore invalid token — treat as unauthenticated service call */
  }
  next();
}
