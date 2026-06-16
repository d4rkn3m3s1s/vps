import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createWebhookHandler,
  deleteWebhookHandler,
  listWebhooksHandler,
  updateWebhookHandler
} from './webhooks.controller';

export const webhooksRouter = Router();

webhooksRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(listWebhooksHandler));
webhooksRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createWebhookHandler));
webhooksRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateWebhookHandler));
webhooksRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteWebhookHandler));
