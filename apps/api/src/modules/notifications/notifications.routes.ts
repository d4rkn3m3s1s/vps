// MOUNT: app.use('/notifications', notificationsRouter) in routes/index.ts
import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  deleteChannelHandler,
  listChannelsHandler,
  saveChannelHandler,
  testChannelHandler
} from './notifications.controller';

export const notificationsRouter = Router();

notificationsRouter.use(requireApiKey, authenticateJwt);

notificationsRouter.get('/channels', asyncHandler(listChannelsHandler));
notificationsRouter.post('/channels', asyncHandler(saveChannelHandler));
notificationsRouter.delete('/channels/:id', asyncHandler(deleteChannelHandler));
notificationsRouter.post('/channels/:id/test', asyncHandler(testChannelHandler));
