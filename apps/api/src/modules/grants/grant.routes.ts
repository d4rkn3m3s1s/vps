import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireAdmin } from '../../middleware/requireAdmin';
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
// Transfer permanently moves a device (WITH its farm account, encrypted credential
// vault + TOTP) to another workspace — an owner-level destructive action. It was
// protected only by requireApiKey+authenticateJwt, so any member (even a read-only
// viewer) could exfiltrate a device + its secrets. Gate it behind admin like every
// other privileged/destructive route (apikeys, system, users). The service also
// verifies the caller is a member of the TARGET workspace before reassigning.
grantRouter.post('/device/:deviceId/transfer', requireAdmin, asyncHandler(transferHandler));
// Revoke a single grant.
grantRouter.delete('/:id', asyncHandler(revokeGrantHandler));
