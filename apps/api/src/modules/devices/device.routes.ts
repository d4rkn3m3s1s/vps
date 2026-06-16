import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createDeviceHandler,
  createGroupHandler,
  deleteDeviceHandler,
  deleteGroupHandler,
  deviceShellHandler,
  deviceStatusSummaryHandler,
  getDeviceHandler,
  heartbeatDeviceHandler,
  listDevicesHandler,
  listGroupsHandler,
  updateDeviceHandler,
  updateGroupHandler
} from './device.controller';

export const deviceRouter = Router();

deviceRouter.get('/', requireApiKey, asyncHandler(listDevicesHandler));
deviceRouter.get('/status/summary', requireApiKey, asyncHandler(deviceStatusSummaryHandler));
deviceRouter.get('/groups', requireApiKey, asyncHandler(listGroupsHandler));
deviceRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createDeviceHandler));
deviceRouter.post('/groups', requireApiKey, authenticateJwt, asyncHandler(createGroupHandler));
deviceRouter.put('/groups/:id', requireApiKey, authenticateJwt, asyncHandler(updateGroupHandler));
deviceRouter.delete('/groups/:id', requireApiKey, authenticateJwt, asyncHandler(deleteGroupHandler));
deviceRouter.get('/:id', requireApiKey, asyncHandler(getDeviceHandler));
deviceRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateDeviceHandler));
deviceRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteDeviceHandler));
deviceRouter.post('/:id/heartbeat', requireApiKey, asyncHandler(heartbeatDeviceHandler));
deviceRouter.post('/:id/shell', requireApiKey, authenticateJwt, asyncHandler(deviceShellHandler));
