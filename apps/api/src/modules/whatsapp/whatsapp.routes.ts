import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { apiRateLimiter } from '../../middleware/rateLimit';
import {
  listConversationsHandler,
  unreadTotalHandler,
  threadMessagesHandler,
  markReadHandler,
  setStateHandler,
  setLabelsHandler,
  getContactHandler,
  setContactHandler,
  getAvatarHandler,
  bulkActionHandler,
  listLabelsHandler,
  createLabelHandler,
  deleteLabelHandler,
  listCannedHandler,
  createCannedHandler,
  updateCannedHandler,
  deleteCannedHandler,
  statsHandler,
  createBroadcastHandler,
  listBroadcastsHandler,
  setAccountHealthManualHandler,
  serveMediaHandler,
  rescanAccountHealthHandler,
} from './whatsapp.controller';

// WhatsApp-Web-style conversation layer for the dashboard. All routes are
// workspace-scoped (requireApiKey + authenticateJwt; the service verifies the
// device belongs to the caller's workspace before touching a thread).
export const whatsappRouter = Router();

// Conversation list (chat sidebar) + unread badge total.
whatsappRouter.get('/conversations', requireApiKey, authenticateJwt, asyncHandler(listConversationsHandler));
whatsappRouter.get('/conversations/unread', requireApiKey, authenticateJwt, asyncHandler(unreadTotalHandler));

// One thread's messages (chat pane), oldest→newest with scroll-up pagination.
whatsappRouter.get('/thread', requireApiKey, authenticateJwt, asyncHandler(threadMessagesHandler));
whatsappRouter.post('/thread/read', requireApiKey, authenticateJwt, asyncHandler(markReadHandler));

// Per-conversation operator state (favourite / archive / pin) + labels + contact.
whatsappRouter.post('/conversations/state', requireApiKey, authenticateJwt, asyncHandler(setStateHandler));
whatsappRouter.post('/conversations/labels', requireApiKey, authenticateJwt, asyncHandler(setLabelsHandler));
whatsappRouter.get('/conversations/contact', requireApiKey, authenticateJwt, asyncHandler(getContactHandler));
whatsappRouter.post('/conversations/contact', requireApiKey, authenticateJwt, asyncHandler(setContactHandler));
// Lazy-loaded avatar (data-URI) for one thread — kept out of the list payload.
whatsappRouter.get('/conversations/avatar', requireApiKey, authenticateJwt, asyncHandler(getAvatarHandler));

// Bulk actions over many threads at once (200+ chat management).
whatsappRouter.post('/conversations/bulk', requireApiKey, authenticateJwt, asyncHandler(bulkActionHandler));

// Labels (categories) CRUD.
whatsappRouter.get('/labels', requireApiKey, authenticateJwt, asyncHandler(listLabelsHandler));
whatsappRouter.post('/labels', requireApiKey, authenticateJwt, asyncHandler(createLabelHandler));
whatsappRouter.delete('/labels/:id', requireApiKey, authenticateJwt, asyncHandler(deleteLabelHandler));

// Canned replies (message templates) CRUD.
whatsappRouter.get('/canned', requireApiKey, authenticateJwt, asyncHandler(listCannedHandler));
whatsappRouter.post('/canned', requireApiKey, authenticateJwt, asyncHandler(createCannedHandler));
whatsappRouter.patch('/canned/:id', requireApiKey, authenticateJwt, asyncHandler(updateCannedHandler));
whatsappRouter.delete('/canned/:id', requireApiKey, authenticateJwt, asyncHandler(deleteCannedHandler));

// Messaging stats (analytics / SLA).
whatsappRouter.get('/stats', requireApiKey, authenticateJwt, asyncHandler(statsHandler));

// Broadcast (one-to-many throttled send) — rate-limited (drives real devices).
whatsappRouter.post('/broadcast', requireApiKey, authenticateJwt, apiRateLimiter, asyncHandler(createBroadcastHandler));
whatsappRouter.get('/broadcast', requireApiKey, authenticateJwt, asyncHandler(listBroadcastsHandler));

// Hesap sagligi — ELLE ayarla / YENIDEN TARA (★2026-08-18).
// set: operator beyani (kisitli/yasakli hesabi elle ACTIVE'e ceker; audit'e yazilir).
// rescan: cihazi yeniden yoklatir (WHATSAPP_ACCOUNT_HEALTH job) — gercegi sistem soyler,
//         hala kisitliysa damgayi otomatik GERI KOYAR (setAccountHealth monotonik).
// ★2026-08-19 Yakalanan medyayi indir (panel + dis entegrasyon). Workspace'e gore korunur.
whatsappRouter.get('/media/:deviceId/:file', requireApiKey, authenticateJwt, asyncHandler(serveMediaHandler));
whatsappRouter.post('/health/set', requireApiKey, authenticateJwt, asyncHandler(setAccountHealthManualHandler));
whatsappRouter.post('/health/rescan', requireApiKey, authenticateJwt, asyncHandler(rescanAccountHealthHandler));
