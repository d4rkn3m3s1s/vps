import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createJobHandler, getJobHandler, getJobsHandler } from './jobs.controller';

export const jobsRouter = Router();

jobsRouter.get('/', requireApiKey, optionalJwt, asyncHandler(getJobsHandler));
jobsRouter.get('/:id', requireApiKey, optionalJwt, asyncHandler(getJobHandler));
jobsRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createJobHandler));

jobsRouter.use(authenticateJwt);
