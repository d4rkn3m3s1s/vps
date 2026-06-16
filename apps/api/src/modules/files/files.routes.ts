import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { pushFileHandler } from './files.controller';

export const filesRouter = Router();

filesRouter.post('/push', requireApiKey, authenticateJwt, asyncHandler(pushFileHandler));
