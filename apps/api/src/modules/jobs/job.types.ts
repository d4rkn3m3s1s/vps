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
  'WHATSAPP_CONVERSATIONS',
  'WHATSAPP_RECEIPTS',
  'WHATSAPP_MEDIA',
  'WHATSAPP_CALLS',
  'WHATSAPP_SEARCH',
  'WHATSAPP_UNREAD',
  'WHATSAPP_CONTACTS',
  'WHATSAPP_GROUP_MEMBERS',
  'WHATSAPP_CHAT_SUMMARY',
  'WHATSAPP_ACCOUNT_HEALTH',
  'WHATSAPP_FETCH_MEDIA',
  'WHATSAPP_REACTIONS',
  'WHATSAPP_POLLS',
  'WHATSAPP_READ_BY',
  'WHATSAPP_STARRED',
  'WHATSAPP_LABELS',
  'WHATSAPP_VIEW_ONCE',
  'WHATSAPP_VOICE_NOTES',
  'WHATSAPP_DELETED',
  'WHATSAPP_LINKS',
  'WHATSAPP_PROFILE',
  // Change the account's OWN profile display name / picture.
  'WHATSAPP_SET_NAME',
  'WHATSAPP_SET_AVATAR',
  'WHATSAPP_BLOCK',
  'WHATSAPP_BLOCKLIST',
  // Read the account's OWN WhatsApp number off the device (Settings › profile).
  'WHATSAPP_MYNUMBER',
  // ★2026-08-15 Otomatik medya indirme MASKESINI ac (foto/ses/video/belge, 3 ağ
  // durumu). Gelen medyanin otomatik inmesi icin sart (networkSafe). Idempotent +
  // surum-agnostik (You / ⋮ Settings). Yeni cihazlarda kayittan sonra otomatik.
  'WA_SET_AUTODOWNLOAD',
  // Send a media message (image/file) to a peer via wa.me + attach flow.
  'WHATSAPP_SEND_MEDIA',
  // Delete a message: for me (scope=me) or for everyone (scope=everyone).
  'WHATSAPP_DELETE_MSG',
  // Clear all messages in a chat (overflow → Clear chat).
  'WHATSAPP_CLEAR_CHAT',
  // Send a Telegram message from a device via the tg:// deep link + Send tap
  // (mirrors WHATSAPP_SEND; the agent runtime-detects the Telegram package).
  'TELEGRAM_SEND',
  // Register a NEW Telegram account on a device (mirrors REGISTER_WHATSAPP).
  // Phone-number signup with an OTP-park state machine. Telegram-specific parks:
  // OTP delivered in-app to the number's OTHER Telegram device (operator must
  // read it), and a 2FA cloud-password prompt if the number already has an
  // account (operator supplies cloudPassword on the continuation).
  'TELEGRAM_REGISTER',
  'APP_EXPLORE',
  'AGENT_RUN',
  'APPLY_FINGERPRINT',
  'PROVISION_INTEGRITY',
  // Tek-tık cihaz kurulumu: agent boot→WhatsApp-hazır akışını tek job'da sırayla
  // yürütür ve her alt-adımın ilerlemesini /agent/jobs/:id/progress'e bildirir.
  'PROVISION_DEVICE',
  // Waydroid instance'ını GERÇEKTEN başlat/durdur (EMULATOR_START Waydroid'i
  // desteklemiyordu — sadece ack ediyordu). WAKE: wd-run.sh + boot + route,
  // SLEEP: wd-stop.sh. Reboot = SLEEP + WAKE.
  'DEVICE_WAKE',
  'DEVICE_SLEEP',
  // Waydroid instance'ını TAMAMEN yok et (wd-destroy.sh: durdur + userdata/container
  // sil). Cihaz silinince tetiklenir; instance adına göre çalışır (deviceId'ye bağlı
  // DEĞİL — DB satırı silinmiş olabilir). Böylece "sil" host'ta gerçekten temizler.
  'DEVICE_DESTROY'
] as const;

export type JobStatus = (typeof JobStatuses)[number];
export type JobType = (typeof JobTypes)[number];

// Device-exclusive job types: long-running on-device work that drives ADB/UI and
// MUST NOT run two-at-once on the same device (overlapping taps corrupt each
// other, WhatsApp/Waydroid stalls or crashes). When one of these is already
// PENDING/RUNNING for a device, a second is rejected (DEVICE_BUSY) so the
// operator queues them one at a time. Fast, read-only jobs (screenshot, clipboard
// get, shell, mynumber) are intentionally NOT here — they're harmless to overlap
// and blocking them would make the UI feel stuck.
export const EXCLUSIVE_JOB_TYPES: ReadonlySet<JobType> = new Set<JobType>([
  'REGISTER_WHATSAPP',
  'REGISTER_INSTAGRAM',
  'WHATSAPP_SEND',
  'WHATSAPP_SEND_MEDIA',
  'WHATSAPP_PROFILE',
  'WHATSAPP_SET_NAME',
  'WHATSAPP_SET_AVATAR',
  'WHATSAPP_BLOCK',
  'WHATSAPP_BLOCKLIST',
  'WHATSAPP_DELETE_MSG',
  'WHATSAPP_CLEAR_CHAT',
  'TELEGRAM_SEND',
  'TELEGRAM_REGISTER',
  'RPA_RUN',
  'AGENT_RUN',
  'APP_EXPLORE',
  'APPLY_FINGERPRINT',
  'PROVISION_DEVICE',
  'PROVISION_INTEGRITY',
  'EMULATOR_SNAPSHOT_CREATE',
  'EMULATOR_SNAPSHOT_RESTORE',
  'EMULATOR_RESET',
  'EMULATOR_SET_PROXY',
  'DEVICE_WAKE',
  'DEVICE_SLEEP'
]);

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
