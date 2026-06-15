import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { getJobHandler, getJobsHandler } from './jobs.controller';

export const jobsRouter = Router();

jobsRouter.get('/', requireApiKey, asyncHandler(getJobsHandler));
jobsRouter.get('/:id', requireApiKey, asyncHandler(getJobHandler));

jobsRouter.use(authenticateJwt);
