import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { listAuditLogsHandler } from './audit.controller';

export const auditRouter = Router();

auditRouter.get('/', requireApiKey, asyncHandler(listAuditLogsHandler));
