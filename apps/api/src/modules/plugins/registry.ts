import { AdbService } from '../adb/adb.service';
import { DockerService } from '../emulators/docker.service';
import { EmulatorService } from '../emulators/emulator.service';
import { whatsappModule } from './builtins/whatsapp';
import { instagramModule } from './builtins/instagram';
import { facebookModule } from './builtins/facebook';
import type { JobPayload, JobType } from '../jobs/job.types';
import type { PluginContext, PluginJobHandler, SocialModule } from './plugin.interface';

class PluginRegistry {
  private readonly modules = new Map<string, SocialModule>([
    [whatsappModule.id, whatsappModule],
    [instagramModule.id, instagramModule],
    [facebookModule.id, facebookModule]
  ]);

  list(): SocialModule[] {
    return Array.from(this.modules.values());
  }

  get(moduleId: string): SocialModule | undefined {
    return this.modules.get(moduleId);
  }

  getJobHandler(jobName: JobType, context: PluginContext): PluginJobHandler | undefined {
    if (jobName !== 'EMULATOR_OPEN_APP' && jobName !== 'EMULATOR_CLOSE_APP') {
      return undefined;
    }

    return async (job) => {
      const moduleId = typeof job.data.moduleId === 'string' ? job.data.moduleId : undefined;
      const module = moduleId ? this.modules.get(moduleId) : undefined;
      if (!module) {
        return undefined;
      }

      const emulator = await context.emulatorService.getById(String(job.data.emulatorId));
      if (!emulator?.adbHost || !emulator.adbPort) {
        throw new Error('Emulator ADB endpoint not available');
      }

      const serial = `${emulator.adbHost}:${emulator.adbPort}`;
      if (jobName === 'EMULATOR_OPEN_APP') {
        return module.open(serial, context.adbService);
      }
      return module.close(serial, context.adbService);
    };
  }
}

export const pluginRegistry = new PluginRegistry();
