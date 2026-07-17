import type { DeviceStatus } from '@prisma/client';

export type DeviceCreateInput = {
  name: string;
  ipAddress?: string | undefined;
  adbPort?: number | undefined;
  androidVersion?: string | undefined;
  groupId?: string | undefined;
  countryCode?: string | undefined;
  metadata?: unknown;
  // Bind the device to a KVM host at creation (one-click provisioning needs the
  // Device row host-bound so the agent's claimNext can pick up its job).
  hostId?: string | undefined;
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
  tags?: string[] | undefined;
  protected?: boolean | undefined;
};

export type DeviceGroupCreateInput = {
  name: string;
  description?: string | undefined;
};

export type DeviceGroupUpdateInput = {
  name?: string | undefined;
  description?: string | null | undefined;
};
