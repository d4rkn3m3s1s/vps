import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { usageSummaryHandler } from './usage.controller';

export const usageRouter = Router();

usageRouter.get('/summary', requireApiKey, authenticateJwt, asyncHandler(usageSummaryHandler));
