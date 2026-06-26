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
    res.status(error.statusCode).json({
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
