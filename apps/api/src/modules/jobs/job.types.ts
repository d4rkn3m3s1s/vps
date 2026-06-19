export const JobStatuses = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export const JobTypes = [
  'EMULATOR_CREATE',
  'EMULATOR_START',
  'EMULATOR_STOP',
  'EMULATOR_DELETE',
  'EMULATOR_INSTALL_APK',
  'EMULATOR_SCREENSHOT',
  'EMULATOR_SHELL',
  'EMULATOR_OPEN_APP',
  'EMULATOR_CLOSE_APP',
  'EMULATOR_PUSH_FILE',
  'EMULATOR_SET_PROXY',
  'RPA_RUN',
  'EMULATOR_SNAPSHOT_CREATE',
  'EMULATOR_SNAPSHOT_RESTORE',
  'EMULATOR_RESET',
  'EMULATOR_PULL_FILE',
  'EMULATOR_CLIPBOARD_SET',
  'EMULATOR_CLIPBOARD_GET'
] as const;

export type JobStatus = (typeof JobStatuses)[number];
export type JobType = (typeof JobTypes)[number];

export type JobPayload = {
  emulatorId?: string | undefined;
  moduleId?: string | undefined;
  image?: string | undefined;
  adbPort?: number | undefined;
  apkPath?: string | undefined;
  command?: string | undefined;
  packageName?: string | undefined;
  activity?: string | undefined;
  metadata?: unknown;
  [key: string]: unknown;
};
