'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@heroui/react';
import { PageHeader } from '../../../components/PageHeader';
import { PageMotion } from '../../../components/Motion';
import { AdbAccessPanel } from './AdbAccessPanel';

export type DetailFingerprint = {
  imei: string;
  manufacturer: string;
  model: string;
  osVersion: string;
  buildNumber: string;
  macAddress: string;
  resolution: string;
  dpi: number;
  carrier: string;
  country: string;
  timezone: string;
  language: string;
  latitude: number | null;
  longitude: number | null;
  gpsEnabled: boolean;
};

export type DetailHost = {
  id: string;
  name: string;
  region?: string | null;
  status: string;
};

export type DetailDevice = {
  id: string;
  name: string;
  status: string;
  ipAddress: string | null;
  adbPort: number | null;
  androidVersion: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  lastSeen: string | null;
  hostId?: string | null;
  group?: { id: string; name: string } | null;
  host?: { id: string; name: string } | null;
  fingerprint?: DetailFingerprint | null;
};

export type DetailJob = {
  id: string;
  type: string;
  status: string;
  emulatorId: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  ONLINE: 'Running',
  OFFLINE: 'Stopped',
  STARTING: 'Starting',
  STOPPING: 'Stopping',
  ERROR: 'Error'
};

function statusDot(status: string): string {
  if (status === 'ONLINE' || status === 'COMPLETED') return 'dot dot-online';
  if (status === 'ERROR' || status === 'FAILED') return 'dot dot-error';
  if (status === 'STARTING' || status === 'STOPPING' || status === 'RUNNING') return 'dot dot-busy';
  return 'dot dot-offline';
}

export function ProfileDetailView({
  device,
  jobs,
  hosts
}: {
  device: DetailDevice;
  jobs: DetailJob[];
  hosts: DetailHost[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string>(device.host?.id ?? device.hostId ?? '');
  const fp = device.fingerprint;

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 3000);
  }

  async function action(jobType: string, status: string, label: string) {
    setBusy(label);
    try {
      await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [device.id], jobType })
      });
      await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      flash(`${label} queued`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function screenshot() {
    setBusy('Screenshot');
    try {
      await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [device.id], jobType: 'EMULATOR_SCREENSHOT' })
      });
      flash('Screenshot queued — see Jobs');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Assigns (or clears, when empty) the KVM host this device physically runs on.
  // The host agent only claims jobs for devices assigned to it.
  async function assignHost(next: string) {
    setHostId(next);
    setBusy('Host');
    try {
      await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: next === '' ? null : next })
      });
      flash(next === '' ? 'Host cleared' : 'Host assigned');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title={device.name}
        subtitle={`${STATUS_LABEL[device.status] ?? device.status} · ${fp?.country ?? '—'}`}
        actions={
          <>
            <Button variant="ghost" className="btn-ghost" isDisabled={Boolean(busy)} onPress={() => action('EMULATOR_START', 'STARTING', 'Start')}>
              ▷ Start
            </Button>
            <Button variant="ghost" className="btn-ghost" isDisabled={Boolean(busy)} onPress={() => action('EMULATOR_STOP', 'STOPPING', 'Stop')}>
              ◻ Stop
            </Button>
            <Button variant="primary" className="btn-primary" isDisabled={Boolean(busy)} onPress={screenshot}>
              ◰ Screenshot
            </Button>
          </>
        }
      />

      {toast ? <div className="toast toast-ok">{toast}</div> : null}

      <section className="section-grid">
        <div className="panel">
          <h2>Live status</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">State</span>
              <span className="status-chip"><span className={statusDot(device.status)} /> {STATUS_LABEL[device.status] ?? device.status}</span>
            </div>
            <div className="row"><span className="helper">CPU</span><span className="mono">{Math.round(device.cpuUsage)}%</span></div>
            <div className="row"><span className="helper">Memory</span><span className="mono">{Math.round(device.memoryUsage)}%</span></div>
            <div className="row"><span className="helper">Disk</span><span className="mono">{Math.round(device.diskUsage)}%</span></div>
            <div className="row"><span className="helper">ADB endpoint</span><span className="mono">{device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : 'awaiting host'}</span></div>
            <div className="row"><span className="helper">Group</span><span>{device.group?.name ?? 'Ungrouped'}</span></div>
            <div className="row">
              <span className="helper">KVM host</span>
              <select
                className="inline-select"
                value={hostId}
                disabled={busy === 'Host'}
                onChange={(e) => assignHost(e.target.value)}
              >
                <option value="">Unassigned</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {h.region ? ` · ${h.region}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="row"><span className="helper">Last seen</span><span className="mono">{device.lastSeen ? new Date(device.lastSeen).toLocaleString('tr-TR') : 'never'}</span></div>
          </div>
        </div>

        <div className="panel">
          <h2>Device fingerprint</h2>
          {fp ? (
            <div className="panel-stack">
              <div className="row"><span className="helper">Model</span><span>{fp.manufacturer} {fp.model}</span></div>
              <div className="row"><span className="helper">OS</span><span className="mono">Android {fp.osVersion}</span></div>
              <div className="row"><span className="helper">IMEI</span><span className="mono">{fp.imei}</span></div>
              <div className="row"><span className="helper">MAC</span><span className="mono">{fp.macAddress}</span></div>
              <div className="row"><span className="helper">Screen</span><span className="mono">{fp.resolution} @ {fp.dpi}dpi</span></div>
              <div className="row"><span className="helper">Carrier</span><span>{fp.carrier}</span></div>
              <div className="row"><span className="helper">Locale</span><span>{fp.country} · {fp.language} · {fp.timezone}</span></div>
              <div className="row">
                <span className="helper">GPS</span>
                <span className="mono">
                  {fp.gpsEnabled ? `${fp.latitude ?? '—'}, ${fp.longitude ?? '—'}` : 'disabled'}
                </span>
              </div>
            </div>
          ) : (
            <p className="helper">No fingerprint generated.</p>
          )}
        </div>
      </section>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h2>Job history ({jobs.length})</h2>
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="table-empty">
                      <div className="empty-art">☰</div>
                      <span>No jobs for this profile yet</span>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id}>
                    <td><strong>{j.type}</strong></td>
                    <td><span className="status-chip"><span className={statusDot(j.status)} /> {j.status}</span></td>
                    <td className="helper">{new Date(j.createdAt).toLocaleString('tr-TR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AdbAccessPanel deviceId={device.id} />
    </PageMotion>
  );
}
