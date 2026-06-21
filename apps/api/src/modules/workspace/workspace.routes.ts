import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createWorkspaceHandler,
  getSettingsHandler,
  inviteMemberHandler,
  listMembersHandler,
  listWorkspacesHandler,
  removeMemberHandler,
  switchWorkspaceHandler,
  updateMemberHandler,
  updateSettingsHandler,
  updateWorkspaceHandler
} from './workspace.controller';

export const workspaceRouter = Router();

workspaceRouter.use(requireApiKey, authenticateJwt);

workspaceRouter.get('/', asyncHandler(listWorkspacesHandler));
workspaceRouter.post('/', asyncHandler(createWorkspaceHandler));
workspaceRouter.patch('/:id', asyncHandler(updateWorkspaceHandler));
workspaceRouter.get('/:id/settings', asyncHandler(getSettingsHandler));
workspaceRouter.put('/:id/settings', asyncHandler(updateSettingsHandler));
workspaceRouter.post('/:id/switch', asyncHandler(switchWorkspaceHandler));
workspaceRouter.get('/:id/members', asyncHandler(listMembersHandler));
workspaceRouter.post('/:id/members', asyncHandler(inviteMemberHandler));
workspaceRouter.put('/:id/members/:memberId', asyncHandler(updateMemberHandler));
workspaceRouter.delete('/:id/members/:memberId', asyncHandler(removeMemberHandler));
