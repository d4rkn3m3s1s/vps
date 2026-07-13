import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';
import { isAppError } from '../lib/errors';

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.flatten(),
      requestId: req.requestId
    });
    return;
  }

  if (isAppError(error)) {
    // Leave a trail for security-relevant failures so brute-force / probing /
    // cross-tenant attempts are diagnosable from logs. Auth/permission/rate-limit
    // failures (401/403/429) and server errors (5xx) are logged with request
    // context — but NOT the request body/secrets. Ordinary 4xx (400/404/409) stay
    // quiet to avoid log noise. userId is safe context; the code identifies the
    // failure class (INVALID_CREDENTIALS, FORBIDDEN, RATE_LIMITED, …).
    const sc = error.statusCode;
    if (sc === 401 || sc === 403 || sc === 429 || sc >= 500) {
      const meta = {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        code: error.code,
        status: sc,
        ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
        ip: req.ip
      };
      if (sc >= 500) logger.error('Request failed', meta);
      else logger.warn('Security-relevant request rejected', meta);
    }
    res.status(sc).json({
      error: error.code,
      message: error.message,
      details: error.details,
      requestId: req.requestId
    });
    return;
  }

  logger.error('Unhandled error', {
    requestId: req.requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Unexpected error occurred',
    requestId: req.requestId
  });
}
