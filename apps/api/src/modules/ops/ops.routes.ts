import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { listRequestsHandler } from './ops.controller';

export const opsRouter = Router();

// Canli operasyon: son HTTP istekleri + ozet sayaclar (bellek halka tamponundan).
opsRouter.get('/requests', requireApiKey, authenticateJwt, asyncHandler(listRequestsHandler));
