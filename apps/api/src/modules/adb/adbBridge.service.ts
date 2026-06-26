import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { AdbService } from './adb.service';

const adb = new AdbService();

// Returns the device row or 404s. Workspace scoping is enforced by the caller
// passing workspaceId (interactive) — service identity may omit it.
async function getDevice(deviceId: string, workspaceId?: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || (workspaceId && device.workspaceId !== workspaceId)) {
    throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }
  return device;
}

function internalSerial(device: { ipAddress: string | null; adbPort: number | null }): string {
  if (!device.ipAddress || !device.adbPort) {
    throw new AppError('Device has no ADB endpoint yet (awaiting host)', 409, 'DEVICE_AWAITING_ADB');
  }
  return `${device.ipAddress}:${device.adbPort}`;
}

export class AdbBridgeService {
  // Connection details for an external operator. Returns the internal serial
  // (reachable from the host network) and, when the device is publicly exposed,
  // the public host:port plus a ready-to-paste command set. Never returns secrets.
  async connectInfo(deviceId: string, workspaceId?: string) {
    const device = await getDevice(deviceId, workspaceId);
    const serial = internalSerial(device);
    const exposed = device.adbExposed && device.adbPublicHost && device.adbPublicPort;
    const target = exposed ? `${device.adbPublicHost}:${device.adbPublicPort}` : serial;

    return {
      deviceId: device.id,
      name: device.name,
      serial,
      exposed: Boolean(exposed),
      ...(exposed ? { publicHost: device.adbPublicHost, publicPort: device.adbPublicPort } : {}),
      allowlist: device.adbAllowlist,
      // Ready-to-run commands the operator can copy.
      commands: {
        connect: `adb connect ${target}`,
        shell: `adb -s ${target} shell`,
        scrcpy: `scrcpy -s ${target}`,
        disconnect: `adb disconnect ${target}`
      }
    };
  }

  // Synchronous ADB shell exec — runs now and returns stdout/stderr. Intended
  // for interactive tooling and the dashboard console (vs. the async job path).
  async exec(deviceId: string, command: string, workspaceId?: string) {
    const device = await getDevice(deviceId, workspaceId);
    const serial = internalSerial(device);
    try {
      // Best-effort connect first (TCP devices may have dropped the session).
      await adb.connect(serial).catch(() => undefined);
      const result = await adb.shell(serial, command);
      return {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      };
    } catch (error) {
      // adb binary missing or the spawn failed — surface a clean, actionable
      // error instead of a generic 500.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        throw new AppError('ADB is not available on the API host', 502, 'ADB_UNAVAILABLE');
      }
      if (error instanceof AppError) throw error;
      throw new AppError(`ADB exec failed: ${message}`, 502, 'ADB_EXEC_FAILED');
    }
  }

  // Records intent to expose the device's ADB on a public host:port, restricted
  // to an IP allowlist. The host agent reads this config on its next poll and
  // sets up the actual TCP forward. We persist config + return connect info.
  async expose(
    deviceId: string,
    params: { publicHost?: string | undefined; publicPort?: number | undefined; allowlist?: string[] | undefined },
    workspaceId?: string
  ) {
    const device = await getDevice(deviceId, workspaceId);
    internalSerial(device); // ensure it has an endpoint before exposing

    // Default the public host to the device's host network address and reuse the
    // internal ADB port unless the caller overrides.
    const publicHost = params.publicHost ?? device.ipAddress ?? '';
    const publicPort = params.publicPort ?? device.adbPort ?? 0;
    const allowlist = params.allowlist ?? [];

    const updated = await prisma.device.update({
      where: { id: device.id },
      data: {
        adbExposed: true,
        adbPublicHost: publicHost,
        adbPublicPort: publicPort,
        adbAllowlist: allowlist
      }
    });
    return this.connectInfo(updated.id, workspaceId);
  }

  async unexpose(deviceId: string, workspaceId?: string) {
    const device = await getDevice(deviceId, workspaceId);
    await prisma.device.update({
      where: { id: device.id },
      data: { adbExposed: false, adbPublicHost: null, adbPublicPort: null, adbAllowlist: [] }
    });
    return { deviceId: device.id, exposed: false };
  }
}

export const adbBridgeService = new AdbBridgeService();
