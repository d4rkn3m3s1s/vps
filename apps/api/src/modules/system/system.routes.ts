import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
import { getSystemOverviewHandler } from './system.controller';

export const systemRouter = Router();

// Admin-only: this returns platform-global counts (emulators/jobs/audit) + host RAM,
// which must not be exposed to a plain tenant API key. Gate behind JWT + admin.
systemRouter.get('/overview', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(getSystemOverviewHandler));
