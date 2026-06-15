import type { DeviceStatus } from '@prisma/client';

export type DeviceCreateInput = {
  name: string;
  ipAddress?: string | undefined;
  adbPort?: number | undefined;
  androidVersion?: string | undefined;
  groupId?: string | undefined;
  metadata?: unknown;
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
