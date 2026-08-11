import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
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
// ★2026-08-12: `requireAdmin` EKLENDİ — farm/tick ile aynı sınıf. `schedulerService.runDue()`
// platform genelinde çalışıyor (`scheduledTask.findMany` workspace filtresi YOK; sistem
// ticker'ı için doğru), ama HTTP ucu yalnızca `authenticateJwt` taşıyordu: herhangi bir
// kiracının üyesi TÜM kiracıların zamanlanmış görevlerini erkenden tetikleyebiliyordu.
schedulerRouter.post('/run-due', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(runDueHandler));
schedulerRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateScheduleHandler));
schedulerRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteScheduleHandler));
