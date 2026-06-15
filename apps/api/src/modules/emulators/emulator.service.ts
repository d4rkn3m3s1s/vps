import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { env } from '../../config/env';
import { createJob } from '../jobs/jobs.service';
import type { EmulatorCreateInput } from './emulator.types';
import { DockerService } from './docker.service';

export class EmulatorService {
  constructor(private readonly dockerService = new DockerService()) {}

  async create(input: EmulatorCreateInput, createdById?: string): Promise<{ emulatorId: string; jobId: string }> {
    const emulator = await prisma.emulator.create({
      data: {
        name: input.name,
        image: input.image ?? env.emulatorImage,
        ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
        status: 'PENDING',
        ...(createdById ? { createdById } : {})
      }
    });

    const job = await createJob('EMULATOR_CREATE', {
      emulatorId: emulator.id,
      image: emulator.image,
      metadata: emulator.metadata ?? undefined
    }, emulator.id);

    return { emulatorId: emulator.id, jobId: job.id };
  }

  async list() {
    const emulators = await prisma.emulator.findMany({ orderBy: { createdAt: 'desc' } });
    return emulators;
  }

  async getById(id: string) {
    return prisma.emulator.findUnique({ where: { id } });
  }

  async start(id: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_START', { emulatorId: id }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async stop(id: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_STOP', { emulatorId: id }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async remove(id: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_DELETE', { emulatorId: id }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async installApk(id: string, apkPath: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_INSTALL_APK', { emulatorId: id, apkPath }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async screenshot(id: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_SCREENSHOT', { emulatorId: id }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async shell(id: string, command: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_SHELL', { emulatorId: id, command }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async openApp(id: string, packageName: string, activity?: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_OPEN_APP', { emulatorId: id, packageName, activity }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async closeApp(id: string, packageName: string): Promise<{ emulatorId: string; jobId: string }> {
    await this.assertExists(id);
    const job = await createJob('EMULATOR_CLOSE_APP', { emulatorId: id, packageName }, id);
    return { emulatorId: id, jobId: job.id };
  }

  async syncDockerStatus(): Promise<void> {
    const containers = await this.dockerService.listContainers();
    await Promise.all(
      containers.map(async (container) => {
        await prisma.emulator.updateMany({
          where: { id: container.id },
          data: {
            status: container.state === 'running' ? 'RUNNING' : 'STOPPED',
            containerId: container.id
          }
        });
      })
    );
  }

  private async assertExists(id: string): Promise<void> {
    const emulator = await prisma.emulator.findUnique({ where: { id } });
    if (!emulator) {
      throw new AppError('Emulator not found', 404, 'EMULATOR_NOT_FOUND');
    }
  }
}
