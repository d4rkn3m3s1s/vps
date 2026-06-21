import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireAdmin } from '../../middleware/requireAdmin';
import { createApiKeyHandler, listApiKeysHandler, revokeApiKeyHandler } from './apikeys.controller';

export const apiKeysRouter = Router();

// Managing API keys is an admin action (issuing credentials to external callers).
apiKeysRouter.use(requireApiKey, authenticateJwt, requireAdmin);

apiKeysRouter.get('/', asyncHandler(listApiKeysHandler));
apiKeysRouter.post('/', asyncHandler(createApiKeyHandler));
apiKeysRouter.delete('/:id', asyncHandler(revokeApiKeyHandler));
