import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  acknowledgeEventHandler,
  createRuleHandler,
  deleteRuleHandler,
  listEventsHandler,
  listRulesHandler,
  listTriggersHandler,
  updateRuleHandler
} from './alerts.controller';

export const alertsRouter = Router();

alertsRouter.use(requireApiKey, authenticateJwt);

alertsRouter.get('/triggers', listTriggersHandler);
alertsRouter.get('/rules', asyncHandler(listRulesHandler));
alertsRouter.post('/rules', asyncHandler(createRuleHandler));
alertsRouter.put('/rules/:id', asyncHandler(updateRuleHandler));
alertsRouter.delete('/rules/:id', asyncHandler(deleteRuleHandler));
alertsRouter.get('/events', asyncHandler(listEventsHandler));
alertsRouter.post('/events/:id/ack', asyncHandler(acknowledgeEventHandler));
