import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  cloneSnapshotHandler,
  createSnapshotHandler,
  deleteSnapshotHandler,
  listMarketHandler,
  listSnapshotsHandler,
  resetDeviceHandler,
  restoreSnapshotHandler,
  updateSnapshotHandler
} from './snapshot.controller';

export const snapshotRouter = Router();

snapshotRouter.use(requireApiKey, authenticateJwt);

// Library + public image market.
snapshotRouter.get('/', asyncHandler(listSnapshotsHandler));
snapshotRouter.get('/market', asyncHandler(listMarketHandler));
// Capture from a device, restore/clone, edit, delete.
snapshotRouter.post('/device/:deviceId', asyncHandler(createSnapshotHandler));
snapshotRouter.post('/device/:deviceId/reset', asyncHandler(resetDeviceHandler));
snapshotRouter.post('/:id/restore', asyncHandler(restoreSnapshotHandler));
snapshotRouter.post('/:id/clone', asyncHandler(cloneSnapshotHandler));
snapshotRouter.put('/:id', asyncHandler(updateSnapshotHandler));
snapshotRouter.delete('/:id', asyncHandler(deleteSnapshotHandler));
