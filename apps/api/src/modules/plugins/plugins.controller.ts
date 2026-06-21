import type { Request, Response } from 'express';
import { AppError } from '../../lib/errors';
import { pluginRegistry } from './registry';

function requirePluginId(req: Request): string {
  const pluginId = req.params.id;
  if (typeof pluginId !== 'string') {
    throw new AppError('Plugin id is required', 400, 'INVALID_PLUGIN_ID');
  }

  return pluginId;
}

export async function listPluginsHandler(_req: Request, res: Response): Promise<void> {
  res.json({
    data: pluginRegistry.list().map((plugin) => ({
      id: plugin.id,
      displayName: plugin.displayName,
      packageName: plugin.packageName,
      activity: plugin.activity ?? null,
      canInstallFromApk: plugin.canInstallFromApk
    }))
  });
}

export async function getPluginHandler(req: Request, res: Response): Promise<void> {
  const plugin = pluginRegistry.get(requirePluginId(req));
  if (!plugin) {
    res.status(404).json({ error: 'PLUGIN_NOT_FOUND', message: 'Plugin not found' });
    return;
  }

  res.json({
    data: {
      id: plugin.id,
      displayName: plugin.displayName,
      packageName: plugin.packageName,
      activity: plugin.activity ?? null,
      canInstallFromApk: plugin.canInstallFromApk
    }
  });
}
