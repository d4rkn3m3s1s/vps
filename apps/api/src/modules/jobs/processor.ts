import type { Job as BullJob } from 'bullmq';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { AdbService } from '../adb/adb.service';
import { DockerService } from '../emulators/docker.service';
import { webhooksService } from '../webhooks/webhooks.service';
import { deviceHub } from '../devices/device.hub';
import type { JobPayload, JobType } from './job.types';

const dockerService = new DockerService();
const adbService = new AdbService();

function getSerial(emulator: { adbHost: string | null; adbPort: number | null }): string {
  if (!emulator.adbHost || !emulator.adbPort) {
    throw new AppError('Emulator is missing ADB endpoint information', 409, 'EMULATOR_AWAITING_ADB');
  }

  return `${emulator.adbHost}:${emulator.adbPort}`;
}

// Resolves an ADB serial from a job payload that carries a Device id (the shape
// the dashboard sends). Devices expose their ADB endpoint via ipAddress:adbPort.
async function getDeviceSerial(deviceId: string): Promise<string> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  if (!device.ipAddress || !device.adbPort) {
    throw new AppError('Device is missing ADB endpoint (awaiting KVM host)', 409, 'DEVICE_AWAITING_ADB');
  }
  return `${device.ipAddress}:${device.adbPort}`;
}

async function updateJob(jobId: string, data: { status: 'RUNNING' | 'COMPLETED' | 'FAILED'; result?: unknown; error?: string }): Promise<void> {
  const updateData: Record<string, unknown> = { status: data.status };
  if (data.status === 'RUNNING') updateData.startedAt = new Date();
  if (data.status === 'COMPLETED' || data.status === 'FAILED') updateData.finishedAt = new Date();
  if (data.result !== undefined) updateData.result = data.result;
  if (data.error !== undefined) updateData.error = data.error;

  const updated = await prisma.job.update({ where: { id: jobId }, data: updateData });

  // Push a real-time job update to connected dashboards.
  deviceHub.broadcast({
    type: 'job.updated',
    deviceId: (updated.payload as { deviceId?: string } | null)?.deviceId ?? updated.emulatorId ?? '',
    payload: { id: updated.id, type: updated.type, status: updated.status },
    timestamp: new Date().toISOString(),
    workspaceId: updated.workspaceId ?? undefined
  });

  // Fire outbound webhooks on terminal states (best-effort, never blocks).
  if (data.status === 'COMPLETED' || data.status === 'FAILED') {
    void webhooksService.dispatch(
      data.status === 'COMPLETED' ? 'JOB_COMPLETED' : 'JOB_FAILED',
      {
        jobId: updated.id,
        jobType: updated.type,
        ...(updated.error ? { error: updated.error } : {})
      },
      updated.workspaceId ?? undefined
    );
  }
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
      case 'EMULATOR_PUSH_FILE': {
        const serial = await getDeviceSerial(String(job.data.deviceId));
        const url = String(job.data.url ?? '');
        const fileName = String(job.data.fileName ?? 'file');
        if (!url) throw new AppError('url is required', 400, 'INVALID_URL');
        // Download to a temp path, push to the device, then media-scan.
        const tmp = `/tmp/${Date.now()}-${fileName}`;
        const dest = job.data.destination === 'downloads' ? `/sdcard/Download/${fileName}` : `/sdcard/DCIM/${fileName}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new AppError('Failed to download file', 502, 'DOWNLOAD_FAILED');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(tmp, Buffer.from(await resp.arrayBuffer()));
        await adbService.push(serial, tmp, dest);
        const scan = await adbService.scanMedia(serial, dest);
        await updateJob(job.id as string, { status: 'COMPLETED', result: { dest, scan } });
        return { dest };
      }
      case 'EMULATOR_SET_PROXY': {
        const serial = await getDeviceSerial(String(job.data.deviceId));
        const host = String(job.data.host ?? '');
        const port = job.data.port;
        if (!host || typeof port !== 'number') throw new AppError('host and port are required', 400, 'INVALID_PROXY');
        const result = await adbService.setProxy(serial, `${host}:${port}`);
        await updateJob(job.id as string, { status: 'COMPLETED', result });
        return result;
      }
      case 'RPA_RUN': {
        const serial = await getDeviceSerial(String(job.data.deviceId));
        const steps = Array.isArray(job.data.steps) ? (job.data.steps as Array<Record<string, unknown>>) : [];
        const results: unknown[] = [];
        // Execute each step in order; wait steps just sleep.
        for (const step of steps) {
          const type = String(step.type);
          if (type === 'tap') results.push(await adbService.tap(serial, Number(step.x), Number(step.y)));
          else if (type === 'swipe') results.push(await adbService.swipe(serial, Number(step.x), Number(step.y), Number(step.x2), Number(step.y2)));
          else if (type === 'type') results.push(await adbService.inputText(serial, String(step.text ?? '')));
          else if (type === 'keyevent') results.push(await adbService.keyevent(serial, Number(step.keycode)));
          else if (type === 'openApp') results.push(await adbService.openApp(serial, String(step.packageName ?? '')));
          else if (type === 'shell') results.push(await adbService.shell(serial, String(step.command ?? '')));
          else if (type === 'wait') await new Promise((r) => setTimeout(r, Number(step.ms ?? 1000)));
        }
        await updateJob(job.id as string, { status: 'COMPLETED', result: { steps: steps.length, results } });
        return { steps: steps.length };
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
