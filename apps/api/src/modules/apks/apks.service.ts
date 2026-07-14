import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJobRecord } from '../jobs/jobs.service';

// Bundled APKs live in the repo under deploy/apks (Git LFS). On a deployed host
// the agent reads them from a well-known directory; the API only needs the
// manifest to list what's available and to hand the agent a file NAME (never a
// host path — the agent resolves its own APK dir via FLEET_APK_DIR).
const MANIFEST_PATH =
  process.env.FLEET_APK_MANIFEST ||
  path.resolve(process.cwd(), '../../deploy/apks/manifest.json');

export type BundledApk = {
  file: string;
  name: string;
  packageName: string;
  version: string;
  sizeMB: number;
  category: string;
  shortLabel: string;
  color: string;
};

let cache: BundledApk[] | null = null;

// Read + cache the bundled-APK manifest. Missing/broken manifest → empty list
// (the page still renders; it just shows no bundled APKs).
export async function listBundledApks(): Promise<BundledApk[]> {
  if (cache) return cache;
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { apks?: BundledApk[] };
    cache = Array.isArray(parsed.apks) ? parsed.apks : [];
  } catch {
    cache = [];
  }
  return cache;
}

// Queue an install of a bundled APK onto one or more devices. The agent looks
// up `apkFile` inside its own APK directory and installs via host-mount +
// `pm install` (robust for the 137 MB WhatsApp APK, where `adb install` stalls).
export async function installBundledApk(
  apkFile: string,
  deviceIds: string[],
  workspaceId?: string
): Promise<{ queued: number; packageName: string | null }> {
  const apks = await listBundledApks();
  const apk = apks.find((a) => a.file === apkFile);
  if (!apk) throw new Error(`bilinmeyen APK: ${apkFile}`);

  let queued = 0;
  for (const deviceId of deviceIds) {
    await createJobRecord(
      'EMULATOR_INSTALL_APK',
      { deviceId, packageName: apk.packageName, apkFile: apk.file, bundled: true },
      undefined,
      workspaceId
    );
    queued += 1;
  }
  return { queued, packageName: apk.packageName };
}
