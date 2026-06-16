import { randomBytes, randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { DEVICE_MODELS, LOCALES, type Locale } from './fingerprint.data';

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
};

export function generateFingerprintData(opts: GenerateOptions = {}): FingerprintFields {
  const dev = pick(DEVICE_MODELS);
  const os = pick(dev.osVersions);
  const locale: Locale = opts.countryCode
    ? LOCALES.find((l) => l.countryCode === opts.countryCode) ?? pick(LOCALES)
    : pick(LOCALES);

  const gpsEnabled = opts.gpsEnabled ?? false;

  return {
    imei: generateImei(),
    androidId: hex(8),
    serialNo: hex(4).toUpperCase(),
    macAddress: macAddress(),
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
    phoneNumber: `${locale.dialCode}${randomInt(1000000000, 9999999999)}`,
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
  async get(deviceId: string) {
    return prisma.deviceFingerprint.findUnique({ where: { deviceId } });
  }

  // Create-or-replace: ensures every device has exactly one fingerprint.
  async ensure(deviceId: string, opts: GenerateOptions = {}) {
    await this.assertDevice(deviceId);
    const data = generateFingerprintData(opts);
    return prisma.deviceFingerprint.upsert({
      where: { deviceId },
      create: { ...data, device: { connect: { id: deviceId } } },
      update: data
    });
  }

  async regenerate(deviceId: string, opts: GenerateOptions = {}) {
    return this.ensure(deviceId, opts);
  }

  async updateGps(deviceId: string, input: { latitude?: number | undefined; longitude?: number | undefined; gpsEnabled?: boolean | undefined; countryCode?: string | undefined }) {
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

    return prisma.deviceFingerprint.update({ where: { deviceId }, data });
  }

  listCountries() {
    return LOCALES.map((l) => ({ countryCode: l.countryCode, country: l.country, timezone: l.timezone }));
  }

  private async assertDevice(deviceId: string): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }
}

function jitterPublic(base: number): number {
  const off = (randomInt(2000) - 1000) / 1000;
  return Number((base + off * 0.05).toFixed(6));
}

export const fingerprintService = new FingerprintService();
