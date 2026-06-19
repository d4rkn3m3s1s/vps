import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireAdmin } from '../../middleware/requireAdmin';
import {
  connectInfoHandler,
  execHandler,
  exposeHandler,
  unexposeHandler
} from '../adb/adbBridge.controller';
import {
  clipboardGetHandler,
  clipboardSetHandler,
  createDeviceHandler,
  createGroupHandler,
  deleteDeviceHandler,
  deleteGroupHandler,
  deviceShellHandler,
  pullFileHandler,
  deviceStatusSummaryHandler,
  getDeviceHandler,
  heartbeatDeviceHandler,
  listDevicesHandler,
  listGroupsHandler,
  provisioningCatalogHandler,
  updateDeviceHandler,
  updateGroupHandler
} from './device.controller';

export const deviceRouter = Router();

deviceRouter.get('/', requireApiKey, optionalJwt, asyncHandler(listDevicesHandler));
deviceRouter.get('/status/summary', requireApiKey, optionalJwt, asyncHandler(deviceStatusSummaryHandler));
deviceRouter.get('/groups', requireApiKey, optionalJwt, asyncHandler(listGroupsHandler));
deviceRouter.get('/provisioning-catalog', requireApiKey, optionalJwt, asyncHandler(provisioningCatalogHandler));
deviceRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createDeviceHandler));
deviceRouter.post('/groups', requireApiKey, authenticateJwt, asyncHandler(createGroupHandler));
deviceRouter.put('/groups/:id', requireApiKey, authenticateJwt, asyncHandler(updateGroupHandler));
deviceRouter.delete('/groups/:id', requireApiKey, authenticateJwt, asyncHandler(deleteGroupHandler));
deviceRouter.get('/:id', requireApiKey, optionalJwt, asyncHandler(getDeviceHandler));
deviceRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateDeviceHandler));
deviceRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteDeviceHandler));
deviceRouter.post('/:id/heartbeat', requireApiKey, asyncHandler(heartbeatDeviceHandler));
deviceRouter.post('/:id/shell', requireApiKey, authenticateJwt, asyncHandler(deviceShellHandler));
// File transfer + clipboard (queued as host-agent jobs).
deviceRouter.post('/:id/clipboard', requireApiKey, authenticateJwt, asyncHandler(clipboardSetHandler));
deviceRouter.post('/:id/clipboard/read', requireApiKey, authenticateJwt, asyncHandler(clipboardGetHandler));
deviceRouter.post('/:id/pull-file', requireApiKey, authenticateJwt, asyncHandler(pullFileHandler));

// External ADB bridge. connect-info is read; exec is a write; expose/unexpose
// are admin-only (opening a public ADB port is a privileged action).
deviceRouter.get('/:id/adb/connect-info', requireApiKey, authenticateJwt, asyncHandler(connectInfoHandler));
deviceRouter.post('/:id/adb/exec', requireApiKey, authenticateJwt, asyncHandler(execHandler));
deviceRouter.post('/:id/adb/expose', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(exposeHandler));
deviceRouter.delete('/:id/adb/expose', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(unexposeHandler));
