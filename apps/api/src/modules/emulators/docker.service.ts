import Docker from 'dockerode';
import net from 'node:net';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

export type EmulatorContainerConfig = {
  id: string;
  name: string;
  image?: string;
  adbPort?: number;
};

export type ContainerState = 'running' | 'stopped' | 'created' | 'deleted';

export type EmulatorContainerInfo = {
  containerId: string;
  adbHost: string;
  adbPort: number;
  state: ContainerState;
  image: string;
};

export class DockerService {
  private readonly docker = new Docker();

  private async getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const { port } = address;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new AppError('Unable to allocate a free port', 500, 'PORT_ALLOCATION_FAILED')));
        }
      });
    });
  }

  async createContainer(config: EmulatorContainerConfig): Promise<EmulatorContainerInfo> {
    const adbPort = config.adbPort ?? (await this.getFreePort());
    const container = await this.docker.createContainer({
      Image: config.image ?? env.emulatorImage,
      name: `emulator-${config.id}`,
      Tty: true,
      HostConfig: {
        PortBindings: {
          '5555/tcp': [{ HostPort: String(adbPort) }]
        },
        RestartPolicy: { Name: 'unless-stopped' }
      },
      Env: [`EMULATOR_ID=${config.id}`],
      Labels: {
        'vps.emulator.id': config.id,
        'vps.emulator.name': config.name
      }
    });

    await container.start();
    return {
      containerId: container.id,
      adbHost: '127.0.0.1',
      adbPort,
      state: 'running',
      image: config.image ?? env.emulatorImage
    };
  }

  async startContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.start();
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.stop({ t: 30 });
  }

  async removeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.remove({ force: true });
  }

  async inspectContainer(containerId: string): Promise<ContainerState> {
    const container = this.docker.getContainer(containerId);
    const inspection = await container.inspect();
    if (!inspection.State.Running && inspection.State.Status === 'created') {
      return 'created';
    }
    return inspection.State.Running ? 'running' : 'stopped';
  }

  async listContainers(): Promise<Array<{ id: string; name: string; state: ContainerState; image: string }>> {
    const containers: Array<{
      Id: string;
      Names?: string[];
      Image: string;
      State?: string;
      Labels?: Record<string, string>;
    }> = (await this.docker.listContainers({ all: true })) as never;
    return containers
      .filter((container) => container.Labels?.['vps.emulator.id'])
      .map((container) => ({
        id: container.Labels?.['vps.emulator.id'] ?? container.Id,
        name: container.Labels?.['vps.emulator.name'] ?? container.Names?.[0]?.replace(/^\//, '') ?? container.Id,
        state: container.State === 'running' ? 'running' : container.State === 'created' ? 'created' : 'stopped',
        image: container.Image
      }));
  }
}
