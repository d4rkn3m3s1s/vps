import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireAdmin } from '../../middleware/requireAdmin';
import { createApiKeyHandler, docApiKeyHandler, listApiKeysHandler, revokeApiKeyHandler } from './apikeys.controller';

export const apiKeysRouter = Router();

// Managing API keys is an admin action (issuing credentials to external callers).
apiKeysRouter.use(requireApiKey, authenticateJwt, requireAdmin);

apiKeysRouter.get('/', asyncHandler(listApiKeysHandler));
// The dedicated docs key (plaintext, minted on first use) for the examples page.
apiKeysRouter.get('/doc-key', asyncHandler(docApiKeyHandler));
apiKeysRouter.post('/', asyncHandler(createApiKeyHandler));
apiKeysRouter.delete('/:id', asyncHandler(revokeApiKeyHandler));
