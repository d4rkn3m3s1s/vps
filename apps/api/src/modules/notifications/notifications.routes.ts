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
import { listFeedHandler, markReadHandler, clearFeedHandler } from './feed.controller';

export const notificationsRouter = Router();

notificationsRouter.use(requireApiKey, authenticateJwt);

// ── Kanallar: bildirimlerin nereye GÖNDERİLECEĞİ (Slack/Telegram/webhook hedefleri)
notificationsRouter.get('/channels', asyncHandler(listChannelsHandler));
notificationsRouter.post('/channels', asyncHandler(saveChannelHandler));
notificationsRouter.delete('/channels/:id', asyncHandler(deleteChannelHandler));
notificationsRouter.post('/channels/:id/test', asyncHandler(testChannelHandler));

// ── Besleme: panelin zil ikonundaki KALICI bildirim listesi (feed.service.ts).
// Eskiden bu liste yalnızca tarayıcı belleğindeydi ve her yenilemede kayboluyordu.
notificationsRouter.get('/feed', asyncHandler(listFeedHandler));
notificationsRouter.post('/feed/read', asyncHandler(markReadHandler));
notificationsRouter.delete('/feed', asyncHandler(clearFeedHandler));
