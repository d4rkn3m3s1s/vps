import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { fleetHealthHandler, registerAnalyticsHandler } from './fleet-health.controller';

export const fleetHealthRouter = Router();

// optionalJwt: scope to the caller's workspace when a token is present.
fleetHealthRouter.get('/summary', requireApiKey, optionalJwt, asyncHandler(fleetHealthHandler));
fleetHealthRouter.get('/register-analytics', requireApiKey, optionalJwt, asyncHandler(registerAnalyticsHandler));
