import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createWebhookHandler,
  deleteWebhookHandler,
  listDeliveriesHandler,
  listWebhooksHandler,
  redeliverHandler,
  sendTestHandler,
  updateWebhookHandler
} from './webhooks.controller';

export const webhooksRouter = Router();

webhooksRouter.use(requireApiKey, authenticateJwt);

webhooksRouter.get('/', asyncHandler(listWebhooksHandler));
webhooksRouter.post('/', asyncHandler(createWebhookHandler));
webhooksRouter.put('/:id', asyncHandler(updateWebhookHandler));
webhooksRouter.delete('/:id', asyncHandler(deleteWebhookHandler));
webhooksRouter.get('/:id/deliveries', asyncHandler(listDeliveriesHandler));
webhooksRouter.post('/:id/test', asyncHandler(sendTestHandler));
webhooksRouter.post('/deliveries/:deliveryId/redeliver', asyncHandler(redeliverHandler));
