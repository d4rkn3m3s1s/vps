import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { getSystemOverviewHandler } from './system.controller';

export const systemRouter = Router();

systemRouter.get('/overview', requireApiKey, asyncHandler(getSystemOverviewHandler));
