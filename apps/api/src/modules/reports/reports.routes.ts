import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { reportJobsHandler, reportSummaryHandler } from './reports.controller';

export const reportsRouter = Router();

reportsRouter.use(requireApiKey, authenticateJwt);
reportsRouter.get('/summary', asyncHandler(reportSummaryHandler));
reportsRouter.get('/jobs', asyncHandler(reportJobsHandler));
