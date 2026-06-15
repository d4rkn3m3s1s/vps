import type { Job as BullJob } from 'bullmq';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { AdbService } from '../adb/adb.service';
import { DockerService } from '../emulators/docker.service';
import type { JobPayload, JobType } from './job.types';

const dockerService = new DockerService();
const adbService = new AdbService();

function getSerial(emulator: { adbHost: string | null; adbPort: number | null }): string {
  if (!emulator.adbHost || !emulator.adbPort) {
    throw new AppError('Emulator is missing ADB endpoint information', 409, 'EMULATOR_AWAITING_ADB');
  }

  return `${emulator.adbHost}:${emulator.adbPort}`;
}

async function updateJob(jobId: string, data: { status: 'RUNNING' | 'COMPLETED' | 'FAILED'; result?: unknown; error?: string }): Promise<void> {
  const updateData: Record<string, unknown> = { status: data.status };
  if (data.status === 'RUNNING') updateData.startedAt = new Date();
  if (data.status === 'COMPLETED' || data.status === 'FAILED') updateData.finishedAt = new Date();
  if (data.result !== undefined) updateData.result = data.result;
  if (data.error !== undefined) updateData.error = data.error;

  await prisma.job.update({ where: { id: jobId }, data: updateData });
}

export async function processJob(job: BullJob<JobPayload, unknown, JobType>): Promise<unknown> {
  await updateJob(job.id as string, { status: 'RUNNING' });

  try {
    switch (job.name) {
      case 'EMULATOR_CREATE': {
        const emulatorId = String(job.data.emulatorId);
        const emulator = await prisma.emulator.findUnique({ where: { id: emulatorId } });
        if (!emulator) throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');

        const result = await dockerService.createContainer({
          id: emulator.id,
          name: emulator.name,
          image: typeof job.data.image === 'string' ? job.data.image : emulator.image,
          ...(typeof job.data.adbPort === 'number' ? { adbPort: job.data.adbPort } : {})
        });

        const updated = await prisma.emulator.update({
          where: { id: emulator.id },
          data: {
            containerId: result.containerId,
            adbHost: result.adbHost,
            adbPort: result.adbPort,
            status: 'RUNNING'
          }
        });

        await updateJob(job.id as string, {
          status: 'COMPLETED',
          result: { emulatorId: updated.id, containerId: result.containerId, adbHost: result.adbHost, adbPort: result.adbPort }
        });
        return updated;
      }
      case 'EMULATOR_START': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator?.containerId) throw new AppError('Emulator container not found', 404, 'EMULATOR_NOT_FOUND');
        await dockerService.startContainer(emulator.containerId);
        const updated = await prisma.emulator.update({ where: { id: emulator.id }, data: { status: 'RUNNING' } });
        await updateJob(job.id as string, { status: 'COMPLETED', result: updated });
        return updated;
      }
      case 'EMULATOR_STOP': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator?.containerId) throw new AppError('Emulator container not found', 404, 'EMULATOR_NOT_FOUND');
        await dockerService.stopContainer(emulator.containerId);
        const updated = await prisma.emulator.update({ where: { id: emulator.id }, data: { status: 'STOPPED' } });
        await updateJob(job.id as string, { status: 'COMPLETED', result: updated });
        return updated;
      }
      case 'EMULATOR_DELETE': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator?.containerId) throw new AppError('Emulator container not found', 404, 'EMULATOR_NOT_FOUND');
        await dockerService.removeContainer(emulator.containerId);
        const updated = await prisma.emulator.update({ where: { id: emulator.id }, data: { status: 'DELETED' } });
        await updateJob(job.id as string, { status: 'COMPLETED', result: updated });
        return updated;
      }
      case 'EMULATOR_INSTALL_APK': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator) throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');
        const serial = getSerial(emulator);
        const apkPath = String(job.data.apkPath ?? '');
        if (!apkPath) throw new AppError('apkPath is required', 400, 'INVALID_APK_PATH');
        const install = await adbService.install(serial, apkPath);
        await updateJob(job.id as string, { status: 'COMPLETED', result: install });
        return install;
      }
      case 'EMULATOR_SCREENSHOT': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator) throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');
        const serial = getSerial(emulator);
        const screenshotBase64 = await adbService.screenshot(serial);
        await updateJob(job.id as string, { status: 'COMPLETED', result: { screenshotBase64 } });
        return { screenshotBase64 };
      }
      case 'EMULATOR_SHELL': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator) throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');
        const serial = getSerial(emulator);
        const command = String(job.data.command ?? '');
        if (!command) throw new AppError('command is required', 400, 'INVALID_COMMAND');
        const result = await adbService.shell(serial, command);
        await updateJob(job.id as string, { status: 'COMPLETED', result });
        return result;
      }
      case 'EMULATOR_OPEN_APP': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator) throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');
        const serial = getSerial(emulator);
        const packageName = String(job.data.packageName ?? '');
        if (!packageName) throw new AppError('packageName is required', 400, 'INVALID_PACKAGE_NAME');
        const result = await adbService.openApp(serial, packageName, typeof job.data.activity === 'string' ? job.data.activity : undefined);
        await updateJob(job.id as string, { status: 'COMPLETED', result });
        return result;
      }
      case 'EMULATOR_CLOSE_APP': {
        const emulator = await prisma.emulator.findUnique({ where: { id: String(job.data.emulatorId) } });
        if (!emulator) throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');
        const serial = getSerial(emulator);
        const packageName = String(job.data.packageName ?? '');
        if (!packageName) throw new AppError('packageName is required', 400, 'INVALID_PACKAGE_NAME');
        const result = await adbService.closeApp(serial, packageName);
        await updateJob(job.id as string, { status: 'COMPLETED', result });
        return result;
      }
      default:
        throw new AppError(`Unsupported job type: ${job.name}`, 400, 'UNSUPPORTED_JOB_TYPE');
    }
  } catch (error) {
    await updateJob(job.id as string, {
      status: 'FAILED',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
