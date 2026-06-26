// MOUNT: app.use('/costs', costsRouter) in routes/index.ts
import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { getCostsHandler } from './costs.controller';

export const costsRouter = Router();

costsRouter.get('/summary', requireApiKey, authenticateJwt, asyncHandler(getCostsHandler));
