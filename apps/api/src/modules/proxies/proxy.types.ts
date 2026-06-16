import type { ProxyStatus, ProxyType } from '@prisma/client';

export type ProxyCreateInput = {
  label: string;
  type?: ProxyType | undefined;
  host: string;
  port: number;
  username?: string | undefined;
  password?: string | undefined;
  group?: string | undefined;
  isp?: string | undefined;
  remarks?: string | undefined;
};

export type ProxyUpdateInput = {
  label?: string | undefined;
  type?: ProxyType | undefined;
  host?: string | undefined;
  port?: number | undefined;
  username?: string | null | undefined;
  password?: string | null | undefined;
  group?: string | null | undefined;
  isp?: string | null | undefined;
  remarks?: string | null | undefined;
  status?: ProxyStatus | undefined;
  exportIp?: string | null | undefined;
};
