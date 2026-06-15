import type { AdbService } from '../adb/adb.service';
import type { EmulatorService } from '../emulators/emulator.service';
import type { DockerService } from '../emulators/docker.service';
import type { Job as BullJob } from 'bullmq';
import type { JobPayload, JobType } from '../jobs/job.types';

export type PluginContext = {
  adbService: AdbService;
  emulatorService: EmulatorService;
  dockerService: DockerService;
};

export type PluginJobHandler = (job: BullJob<JobPayload, unknown, JobType>) => Promise<unknown>;

export interface SocialModule {
  id: string;
  displayName: string;
  packageName: string;
  activity?: string;
  canInstallFromApk: boolean;
  open(serial: string, adbService: AdbService): Promise<unknown>;
  close(serial: string, adbService: AdbService): Promise<unknown>;
}
