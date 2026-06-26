import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.role !== 'admin') {
    next(new AppError('Admin privileges required', 403, 'FORBIDDEN'));
    return;
  }

  next();
}
