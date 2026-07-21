import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createInstanceHandler, createBatchHandler, provisionCancelHandler, provisionCapacityHandler, provisionCpuPressureHandler, provisionStatusHandler, provisionStepsHandler } from './provision.controller';

// Tek-tıkla cihaz oluşturma. Sıfırdan yeni izole Waydroid instance kurar; ilerleme
// canlı olarak /ws/devices üzerinden `provision.progress` event'iyle akar (agent → API).
export const provisionRouter = Router();

provisionRouter.get('/steps', requireApiKey, optionalJwt, asyncHandler(provisionStepsHandler));
provisionRouter.get('/capacity', requireApiKey, optionalJwt, asyncHandler(provisionCapacityHandler));
provisionRouter.get('/cpu-pressure', requireApiKey, optionalJwt, asyncHandler(provisionCpuPressureHandler));
provisionRouter.get('/status/:jobId', requireApiKey, authenticateJwt, asyncHandler(provisionStatusHandler));
provisionRouter.post('/cancel/:jobId', requireApiKey, authenticateJwt, asyncHandler(provisionCancelHandler));
provisionRouter.post('/create', requireApiKey, authenticateJwt, asyncHandler(createInstanceHandler));
provisionRouter.post('/batch', requireApiKey, authenticateJwt, asyncHandler(createBatchHandler));
