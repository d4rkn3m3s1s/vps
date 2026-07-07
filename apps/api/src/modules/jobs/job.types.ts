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
  'EMULATOR_CLIPBOARD_GET',
  'REGISTER_INSTAGRAM',
  'REGISTER_WHATSAPP',
  'WHATSAPP_SEND',
  'WHATSAPP_READ',
  'WHATSAPP_PROFILE',
  'WHATSAPP_BLOCK',
  'WHATSAPP_BLOCKLIST',
  // Read the account's OWN WhatsApp number off the device (Settings › profile).
  'WHATSAPP_MYNUMBER',
  // Send a media message (image/file) to a peer via wa.me + attach flow.
  'WHATSAPP_SEND_MEDIA',
  // Delete a message: for me (scope=me) or for everyone (scope=everyone).
  'WHATSAPP_DELETE_MSG',
  // Clear all messages in a chat (overflow → Clear chat).
  'WHATSAPP_CLEAR_CHAT',
  'APP_EXPLORE',
  'AGENT_RUN',
  'APPLY_FINGERPRINT',
  'PROVISION_INTEGRITY',
  // Tek-tık cihaz kurulumu: agent boot→WhatsApp-hazır akışını tek job'da sırayla
  // yürütür ve her alt-adımın ilerlemesini /agent/jobs/:id/progress'e bildirir.
  'PROVISION_DEVICE'
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
