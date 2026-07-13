import { randomBytes, randomInt } from 'node:crypto';
import { Prisma, type DeviceFingerprint } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, safeDecrypt } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import { DEVICE_MODELS, LOCALES, type Locale } from './fingerprint.data';

// Hardware-identity fields stored AES-256-GCM encrypted at rest. These are the
// device-identifying values an anti-detection system must protect; the rest of
// the fingerprint (model/brand/locale/GPS) is non-identifying display data.
// Encryption happens in generateFingerprintData (so every write path — device
// create, snapshot reset/clone, vast provision — stores ciphertext without those
// modules needing to know), and decryption happens on read (get) and when the
// value is pushed down to the physical device (applyToDevice).
const FP_SECRET_FIELDS = ['imei', 'androidId', 'serialNo', 'macAddress', 'phoneNumber'] as const;

// Decrypt the encrypted identity fields on a stored fingerprint row. safeDecrypt
// keeps pre-encryption plaintext rows readable (backward-compat, no migration).
// Exported so device.getDevice/listDevices can decrypt the eager-loaded
// fingerprint (otherwise IMEI/MAC/serial/androidId/phone show as AES ciphertext
// in the dashboard's device-detail panel).
export function decryptFingerprint<T extends Partial<DeviceFingerprint>>(fp: T): T {
  const out: T = { ...fp };
  for (const f of FP_SECRET_FIELDS) {
    const v = out[f as keyof T];
    if (typeof v === 'string' && v) out[f as keyof T] = safeDecrypt(v) as T[keyof T];
  }
  return out;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(arr.length)] as T;
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

// Luhn-valid 15-digit IMEI so it passes basic checksum validation.
function generateImei(): string {
  const digits: number[] = [];
  for (let i = 0; i < 14; i += 1) digits.push(randomInt(10));
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    let d = digits[i] as number;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return digits.join('') + String(check);
}

function macAddress(): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i += 1) parts.push(hex(1));
  return parts.join(':');
}

function jitter(base: number, deltaDeg: number): number {
  // Random offset within ~deltaDeg degrees to avoid identical coordinates.
  const off = (randomInt(2000) - 1000) / 1000; // -1..1
  return Number((base + off * deltaDeg).toFixed(6));
}

export type FingerprintFields = Omit<
  Prisma.DeviceFingerprintCreateInput,
  'device' | 'id' | 'createdAt' | 'updatedAt'
>;

export type GenerateOptions = {
  countryCode?: string | undefined;
  gpsEnabled?: boolean | undefined;
  // Provisioning: pin a specific catalog model (by `model` string) and/or
  // Android version instead of randomizing, so the operator gets the device
  // they chose at create time.
  model?: string | undefined;
  osVersion?: string | undefined;
};

export function generateFingerprintData(opts: GenerateOptions = {}): FingerprintFields {
  const dev = (opts.model ? DEVICE_MODELS.find((d) => d.model === opts.model) : undefined) ?? pick(DEVICE_MODELS);
  const os = opts.osVersion && dev.osVersions.includes(opts.osVersion) ? opts.osVersion : pick(dev.osVersions);
  const locale: Locale = opts.countryCode
    ? LOCALES.find((l) => l.countryCode === opts.countryCode) ?? pick(LOCALES)
    : pick(LOCALES);

  const gpsEnabled = opts.gpsEnabled ?? false;

  return {
    // Identity fields are encrypted at rest (decrypted on read/apply).
    imei: encryptString(generateImei()),
    androidId: encryptString(hex(8)),
    serialNo: encryptString(hex(4).toUpperCase()),
    macAddress: encryptString(macAddress()),
    manufacturer: dev.manufacturer,
    model: dev.model,
    brand: dev.brand,
    osVersion: os,
    buildNumber: `${dev.brand.toUpperCase()}.${os}.${randomInt(100000, 999999)}`,
    resolution: dev.resolution,
    dpi: dev.dpi,
    carrier: locale.carrier,
    mcc: locale.mcc,
    mnc: locale.mnc,
    phoneNumber: encryptString(`${locale.dialCode}${randomInt(1000000000, 9999999999)}`),
    language: locale.language,
    country: locale.country,
    countryCode: locale.countryCode,
    timezone: locale.timezone,
    latitude: jitter(locale.lat, 0.05),
    longitude: jitter(locale.lng, 0.05),
    gpsEnabled
  };
}

export class FingerprintService {
  async get(deviceId: string, workspaceId?: string) {
    // Scope via the owning device's workspace when a workspace is in context, so a
    // fingerprint can't be read across tenants.
    if (workspaceId) {
      const device = await prisma.device.findFirst({ where: { id: deviceId, workspaceId }, select: { id: true } });
      if (!device) return null;
    }
    const fp = await prisma.deviceFingerprint.findUnique({ where: { deviceId } });
    return fp ? decryptFingerprint(fp) : null;
  }

  // Create-or-replace: ensures every device has exactly one fingerprint.
  async ensure(deviceId: string, opts: GenerateOptions = {}, workspaceId?: string) {
    await this.assertDevice(deviceId, workspaceId);
    // Identity fields in `data` are already encrypted (generateFingerprintData);
    // the row is stored ciphertext but the returned value is decrypted for the
    // caller (the regenerate handler surfaces it to the dashboard).
    const data = generateFingerprintData(opts);
    const saved = await prisma.deviceFingerprint.upsert({
      where: { deviceId },
      create: { ...data, device: { connect: { id: deviceId } } },
      update: data
    });
    return decryptFingerprint(saved);
  }

  async regenerate(deviceId: string, opts: GenerateOptions = {}, workspaceId?: string) {
    return this.ensure(deviceId, opts, workspaceId);
  }

  // ── One-click IDENTITY reroll ──────────────────────────────────────────────
  // Give the device a brand-new anti-detection identity WITHOUT disturbing what
  // the one-click provision set up (screen resolution/dpi, model, OS, country,
  // GPS). We reroll ONLY the identifier surface — IMEI, android_id, serial, MAC,
  // phone number, build number — and keep model/resolution/dpi/timezone/country
  // exactly as-is, then push the identity to the device WITHOUT touching wm
  // size/density/timezone (those would shift WhatsApp's coordinate recipe). This
  // is the safe reroll the operator asked for: "hiçbir özelliğini bozmadan".
  async rerollIdentity(deviceId: string, workspaceId?: string) {
    await this.assertDevice(deviceId, workspaceId);
    const existing = await prisma.deviceFingerprint.findUnique({ where: { deviceId } });
    if (!existing) {
      // No fingerprint yet — fall back to a full generate (screen included, since
      // there's nothing to preserve) and apply everything.
      const created = await this.ensure(deviceId, {}, workspaceId);
      const job = await this.applyIdentityJob(deviceId, created, { includeScreen: true }, workspaceId);
      return { jobId: job.jobId, fingerprint: created };
    }
    // Keep model/os/screen/locale; reroll only the identifiers.
    const data: Prisma.DeviceFingerprintUpdateInput = {
      imei: encryptString(generateImei()),
      androidId: encryptString(hex(8)),
      serialNo: encryptString(hex(4).toUpperCase()),
      macAddress: encryptString(macAddress()),
      buildNumber: `${(existing.brand || 'BRAND').toUpperCase()}.${existing.osVersion || '13'}.${randomInt(100000, 999999)}`
    };
    const saved = decryptFingerprint(await prisma.deviceFingerprint.update({ where: { deviceId }, data }));
    // Apply WITHOUT screen/timezone so the WhatsApp-ready layout stays intact.
    const job = await this.applyIdentityJob(deviceId, saved, { includeScreen: false }, workspaceId);
    return { jobId: job.jobId, fingerprint: saved };
  }

  // Dispatch APPLY_FINGERPRINT. When includeScreen is false we omit
  // resolution/dpi/timezone so the agent doesn't run wm size/density (which would
  // break the pinned 1080x2400 WhatsApp layout). Identity props always go.
  private async applyIdentityJob(
    deviceId: string,
    fp: DeviceFingerprint,
    opts: { includeScreen: boolean },
    workspaceId?: string
  ): Promise<{ jobId: string }> {
    const fingerprint = {
      model: fp.model,
      manufacturer: fp.manufacturer,
      brand: fp.brand,
      osVersion: fp.osVersion,
      buildNumber: fp.buildNumber,
      serialNo: fp.serialNo,
      androidId: fp.androidId,
      ...(opts.includeScreen ? { resolution: fp.resolution, dpi: fp.dpi, timezone: fp.timezone } : {})
    };
    const job = await createJobRecord('APPLY_FINGERPRINT', { deviceId, fingerprint } as never, undefined, workspaceId);
    return { jobId: job.id };
  }

  async updateGps(deviceId: string, input: { latitude?: number | undefined; longitude?: number | undefined; gpsEnabled?: boolean | undefined; countryCode?: string | undefined }, workspaceId?: string) {
    await this.assertDevice(deviceId, workspaceId);
    const existing = await this.get(deviceId);
    if (!existing) throw new AppError('Fingerprint not found', 404, 'FINGERPRINT_NOT_FOUND');

    const data: Prisma.DeviceFingerprintUpdateInput = {};
    if (typeof input.latitude === 'number') data.latitude = input.latitude;
    if (typeof input.longitude === 'number') data.longitude = input.longitude;
    if (typeof input.gpsEnabled === 'boolean') data.gpsEnabled = input.gpsEnabled;
    if (input.countryCode) {
      const locale = LOCALES.find((l) => l.countryCode === input.countryCode);
      if (locale) {
        data.country = locale.country;
        data.countryCode = locale.countryCode;
        data.timezone = locale.timezone;
        data.carrier = locale.carrier;
        data.mcc = locale.mcc;
        data.mnc = locale.mnc;
        if (input.latitude === undefined) data.latitude = jitterPublic(locale.lat);
        if (input.longitude === undefined) data.longitude = jitterPublic(locale.lng);
      }
    }

    const saved = await prisma.deviceFingerprint.update({ where: { deviceId }, data });
    return decryptFingerprint(saved);
  }

  listCountries() {
    return LOCALES.map((l) => ({ countryCode: l.countryCode, country: l.country, timezone: l.timezone }));
  }

  // Push the stored fingerprint DOWN to the physical device: dispatches an
  // APPLY_FINGERPRINT job the host agent runs as setprop over ADB. Only the
  // identifier surface (model/build/serial/android_id) — secrets stay server-side.
  async applyToDevice(deviceId: string, workspaceId?: string) {
    await this.assertDevice(deviceId, workspaceId);
    const fp = await this.get(deviceId);
    if (!fp) throw new AppError('Fingerprint not found', 404, 'FINGERPRINT_NOT_FOUND');
    const fingerprint = {
      model: fp.model,
      manufacturer: fp.manufacturer,
      brand: fp.brand,
      osVersion: fp.osVersion,
      buildNumber: fp.buildNumber,
      serialNo: fp.serialNo,
      androidId: fp.androidId,
      // Root-less applicable extras (wm size/density, timezone).
      resolution: fp.resolution,
      dpi: fp.dpi,
      timezone: fp.timezone
    };
    const job = await createJobRecord('APPLY_FINGERPRINT', { deviceId, fingerprint } as never, undefined, workspaceId);
    return { jobId: job.id };
  }

  // Best-effort Play/device-integrity provisioning (BASIC props over ADB). STRONG
  // hardware attestation needs a real device / Magisk module — the agent reports
  // back whether that's possible. ToS/legal: only on your own consented fleet.
  async provisionIntegrity(deviceId: string, workspaceId?: string) {
    await this.assertDevice(deviceId, workspaceId);
    const job = await createJobRecord('PROVISION_INTEGRITY', { deviceId } as never, undefined, workspaceId);
    return { jobId: job.id };
  }

  // Workspace-scoped device existence check: a device in another tenant reads as
  // "not found" so fingerprint reads/writes can't cross tenants.
  private async assertDevice(deviceId: string, workspaceId?: string): Promise<void> {
    const device = await prisma.device.findFirst({ where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }
}

function jitterPublic(base: number): number {
  const off = (randomInt(2000) - 1000) / 1000;
  return Number((base + off * 0.05).toFixed(6));
}

export const fingerprintService = new FingerprintService();
