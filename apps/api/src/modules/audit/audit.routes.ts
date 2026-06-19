import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { exportAuditLogsHandler, listAuditLogsHandler } from './audit.controller';

export const auditRouter = Router();

auditRouter.get('/', requireApiKey, optionalJwt, asyncHandler(listAuditLogsHandler));
auditRouter.get('/export', requireApiKey, optionalJwt, asyncHandler(exportAuditLogsHandler));
