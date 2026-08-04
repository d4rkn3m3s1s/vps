import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// Ana sayfanın "Canlı Altyapı" kartları için taze ölçüm.
//
// Sunucu bileşeni veriyi yalnızca sayfa açılışında çeker; bu uç, panelin
// yeniden yüklenmeden tazelenmesini sağlar. Hesap sunucu sayfasındakiyle
// AYNI: çevrimiçi cihazların Device.cpuUsage/memoryUsage/diskUsage ortalaması.

type Device = {
  status: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
};

type SystemOverview = {
  queue?: { waiting: number; active: number };
};

export async function GET() {
  const [devicesRes, sysRes] = await Promise.all([
    apiCall<Device[]>('/devices', { auth: true }),
    apiCall<SystemOverview>('/system/overview', { auth: true }),
  ]);

  const devices = Array.isArray(devicesRes.data) ? devicesRes.data : [];
  const online = devices.filter((d) => d.status === 'ONLINE');

  const avg = (pick: (d: Device) => number | undefined): number => {
    if (online.length === 0) return 0;
    const sum = online.reduce((acc, d) => acc + (pick(d) ?? 0), 0);
    return Math.round(sum / online.length);
  };

  return NextResponse.json({
    data: {
      cpuPct: avg((d) => d.cpuUsage),
      memPct: avg((d) => d.memoryUsage),
      diskPct: avg((d) => d.diskUsage),
      onlineCount: online.length,
      queueWaiting: sysRes.data?.queue?.waiting ?? 0,
      queueActive: sysRes.data?.queue?.active ?? 0,
    },
  });
}
