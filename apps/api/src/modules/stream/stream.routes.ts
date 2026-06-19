import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { streamStatsHandler, streamTokenHandler } from './stream.controller';

export const streamRouter = Router();

// Mint a short-lived viewer token for a device's live stream socket.
streamRouter.post('/:deviceId/token', requireApiKey, authenticateJwt, asyncHandler(streamTokenHandler));
// Live hub stats (connected agents / watched devices / viewers).
streamRouter.get('/stats', requireApiKey, authenticateJwt, asyncHandler(streamStatsHandler));
