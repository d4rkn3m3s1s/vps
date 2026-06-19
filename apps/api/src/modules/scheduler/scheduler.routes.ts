import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createScheduleHandler,
  deleteScheduleHandler,
  listSchedulesHandler,
  runDueHandler,
  updateScheduleHandler
} from './scheduler.controller';

export const schedulerRouter = Router();

schedulerRouter.get('/', requireApiKey, optionalJwt, asyncHandler(listSchedulesHandler));
schedulerRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createScheduleHandler));
schedulerRouter.post('/run-due', requireApiKey, authenticateJwt, asyncHandler(runDueHandler));
schedulerRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateScheduleHandler));
schedulerRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteScheduleHandler));
