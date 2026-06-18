import type { DeviceStatus } from '@prisma/client';

export type DeviceCreateInput = {
  name: string;
  ipAddress?: string | undefined;
  adbPort?: number | undefined;
  androidVersion?: string | undefined;
  groupId?: string | undefined;
  countryCode?: string | undefined;
  metadata?: unknown;
  // Provisioning: pin a catalog device model and hardware tier at create time.
  deviceModel?: string | undefined;
  ramGb?: number | undefined;
  cpuCores?: number | undefined;
};

export type DeviceUpdateInput = {
  name?: string | undefined;
  status?: DeviceStatus | undefined;
  ipAddress?: string | undefined;
  adbPort?: number | undefined;
  androidVersion?: string | undefined;
  cpuUsage?: number | undefined;
  memoryUsage?: number | undefined;
  diskUsage?: number | undefined;
  groupId?: string | null | undefined;
  hostId?: string | null | undefined;
  metadata?: unknown;
  lastSeen?: string | Date | undefined;
};

export type DeviceHeartbeatInput = {
  status?: DeviceStatus | undefined;
  cpuUsage?: number | undefined;
  memoryUsage?: number | undefined;
  diskUsage?: number | undefined;
  lastSeen?: string | Date | undefined;
};

export type DeviceGroupCreateInput = {
  name: string;
  description?: string | undefined;
};

export type DeviceGroupUpdateInput = {
  name?: string | undefined;
  description?: string | null | undefined;
};
