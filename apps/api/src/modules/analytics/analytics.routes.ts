import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { analyticsSummaryHandler } from './analytics.controller';

export const analyticsRouter = Router();

analyticsRouter.get('/summary', requireApiKey, asyncHandler(analyticsSummaryHandler));
