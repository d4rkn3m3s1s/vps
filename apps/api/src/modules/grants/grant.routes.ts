import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  grantHandler,
  listDeviceGrantsHandler,
  listReceivedGrantsHandler,
  revokeGrantHandler,
  transferHandler
} from './grant.controller';

export const grantRouter = Router();

grantRouter.use(requireApiKey, authenticateJwt);

// Devices lent to the current user.
grantRouter.get('/received', asyncHandler(listReceivedGrantsHandler));
// Grants on a device + issue/transfer.
grantRouter.get('/device/:deviceId', asyncHandler(listDeviceGrantsHandler));
grantRouter.post('/device/:deviceId', asyncHandler(grantHandler));
grantRouter.post('/device/:deviceId/transfer', asyncHandler(transferHandler));
// Revoke a single grant.
grantRouter.delete('/:id', asyncHandler(revokeGrantHandler));
