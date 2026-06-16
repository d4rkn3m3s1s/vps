import { spawn } from 'node:child_process';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

export type AdbCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export class AdbService {
  private run(args: string[], timeoutMs = 120000): Promise<AdbCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(env.adbBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new AppError('ADB command timed out', 504, 'ADB_TIMEOUT'));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
      });
    });
  }

  async shell(serial: string, command: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', command]);
  }

  async connect(serial: string): Promise<AdbCommandResult> {
    return this.run(['connect', serial]);
  }

  async install(serial: string, apkPath: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'install', '-r', apkPath], 300000);
  }

  async uninstall(serial: string, packageName: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'uninstall', packageName], 120000);
  }

  async openApp(serial: string, packageName: string, activity?: string): Promise<AdbCommandResult> {
    const component = activity ? `${packageName}/${activity}` : packageName;
    return this.run(['-s', serial, 'shell', 'am', 'start', '-n', component]);
  }

  async closeApp(serial: string, packageName: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', 'am', 'force-stop', packageName]);
  }

  async screenshot(serial: string): Promise<string> {
    const result = await this.run(['-s', serial, 'exec-out', 'screencap', '-p'], 120000);
    if (result.exitCode !== 0) {
      throw new AppError('Failed to capture screenshot', 500, 'ADB_SCREENSHOT_FAILED', result.stderr);
    }

    return Buffer.from(result.stdout, 'binary').toString('base64');
  }

  // Pushes a local file onto the device at the given destination path.
  async push(serial: string, localPath: string, remotePath: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'push', localPath, remotePath], 300000);
  }

  // Triggers a media scan so a pushed image/video shows up in the gallery.
  async scanMedia(serial: string, remotePath: string): Promise<AdbCommandResult> {
    return this.run([
      '-s',
      serial,
      'shell',
      'am',
      'broadcast',
      '-a',
      'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
      '-d',
      `file://${remotePath}`
    ]);
  }

  // --- Low-level input primitives used by the RPA runner ---
  async tap(serial: string, x: number, y: number): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]);
  }

  async swipe(serial: string, x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms)]);
  }

  async inputText(serial: string, text: string): Promise<AdbCommandResult> {
    // adb input text uses %s for spaces and does not accept raw spaces.
    const escaped = text.replace(/ /g, '%s');
    return this.run(['-s', serial, 'shell', 'input', 'text', escaped]);
  }

  async keyevent(serial: string, keycode: number): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', 'input', 'keyevent', String(keycode)]);
  }

  // Sets a mock GPS location (requires the device to allow mock locations).
  async setLocation(serial: string, lat: number, lng: number): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'emu', 'geo', 'fix', String(lng), String(lat)]);
  }

  // Configures an HTTP/HTTPS proxy on the device via global settings.
  async setProxy(serial: string, hostPort: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', 'settings', 'put', 'global', 'http_proxy', hostPort]);
  }

  async clearProxy(serial: string): Promise<AdbCommandResult> {
    return this.run(['-s', serial, 'shell', 'settings', 'put', 'global', 'http_proxy', ':0']);
  }
}
