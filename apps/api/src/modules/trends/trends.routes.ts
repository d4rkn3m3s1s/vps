// MOUNT: app.use('/trends', trendsRouter) in routes/index.ts
import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { getTrendsHandler } from './trends.controller';

export const trendsRouter = Router();

trendsRouter.get('/summary', requireApiKey, authenticateJwt, asyncHandler(getTrendsHandler));
