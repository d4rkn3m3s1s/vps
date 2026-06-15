import type { Express } from 'express';
import { auditRouter } from '../modules/audit/audit.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { emulatorRouter } from '../modules/emulators/emulator.routes';
import { deviceRouter } from '../modules/devices/device.routes';
import { jobsRouter } from '../modules/jobs/jobs.routes';
import { pluginsRouter } from '../modules/plugins/plugins.routes';
import { socialRouter } from '../modules/social/social.routes';
import { systemRouter } from '../modules/system/system.routes';

export function registerRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'vps-emulator-platform' });
  });

  app.use('/auth', authRouter);
  app.use('/devices', deviceRouter);
  app.use('/emulators', emulatorRouter);
  app.use('/jobs', jobsRouter);
  app.use('/plugins', pluginsRouter);
  app.use('/social', socialRouter);
  app.use('/audit', auditRouter);
  app.use('/system', systemRouter);
}
