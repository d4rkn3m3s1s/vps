import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { analyticsSummaryHandler } from './analytics.controller';

export const analyticsRouter = Router();

// optionalJwt so the summary can scope to the caller's workspace when a token is
// present, while still working with just the API key.
analyticsRouter.get('/summary', requireApiKey, optionalJwt, asyncHandler(analyticsSummaryHandler));
