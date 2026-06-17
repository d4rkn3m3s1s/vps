'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@heroui/react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type SchedulerDevice = { id: string; name: string };

export type ScheduledTask = {
  id: string;
  name: string;
  jobType: string;
  repeat: string;
  status: string;
  nextRunAt: string;
  lastRunAt: string | null;
  runCount: number;
  device?: { id: string; name: string } | null;
};

const JOB_TYPES = [
  'EMULATOR_START',
  'EMULATOR_STOP',
  'EMULATOR_OPEN_APP',
  'EMULATOR_CLOSE_APP',
  'EMULATOR_INSTALL_APK',
  'EMULATOR_SCREENSHOT',
  'EMULATOR_SHELL'
];

const REPEATS = ['ONCE', 'HOURLY', 'DAILY', 'WEEKLY'];

type Toast = { kind: 'ok' | 'err'; text: string } | null;

function defaultNextRun(): string {
  // A timezone-aware "now + 1h" in datetime-local format would require Date;
  // instead we leave it blank and let the user pick. Empty string keeps the
  // input controlled.
  return '';
}

export function SchedulerView({ tasks, devices }: { tasks: ScheduledTask[]; devices: SchedulerDevice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [form, setForm] = useState({
    name: '',
    jobType: 'EMULATOR_OPEN_APP',
    deviceId: '',
    repeat: 'DAILY',
    nextRunAt: defaultNextRun(),
    packageName: ''
  });

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  async function createTask() {
    if (!form.name.trim() || !form.nextRunAt) {
      flash({ kind: 'err', text: 'Name and first run time are required.' });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (form.packageName.trim()) payload.packageName = form.packageName.trim();
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          jobType: form.jobType,
          repeat: form.repeat,
          // datetime-local has no timezone; append seconds + Z to make it ISO.
          nextRunAt: new Date(form.nextRunAt).toISOString(),
          ...(form.deviceId ? { deviceId: form.deviceId } : {}),
          payload
        })
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      setOpen(false);
      setForm({ name: '', jobType: 'EMULATOR_OPEN_APP', deviceId: '', repeat: 'DAILY', nextRunAt: '', packageName: '' });
      flash({ kind: 'ok', text: 'Scheduled task created.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Create failed' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(task: ScheduledTask) {
    const next = task.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await fetch(`/api/schedules/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next })
    });
    router.refresh();
  }

  async function remove(task: ScheduledTask) {
    if (!confirm(`Delete schedule "${task.name}"?`)) return;
    await fetch(`/api/schedules/${task.id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Scheduler"
        subtitle="Run automation tasks on a recurring schedule across your cloud phones."
        actions={
          <Button type="button" variant="primary" className="btn-primary" onPress={() => setOpen(true)}>
            + New schedule
          </Button>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <div className="profile-table-wrap">
        <table className="profile-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Type</th>
              <th>Device</th>
              <th>Repeat</th>
              <th>Next run</th>
              <th>Runs</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="table-empty">
                    <div className="empty-art">⏱</div>
                    <span>No scheduled tasks yet</span>
                  </div>
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                  </td>
                  <td className="mono helper">{t.jobType}</td>
                  <td>{t.device?.name ?? '—'}</td>
                  <td>{t.repeat}</td>
                  <td className="mono">{new Date(t.nextRunAt).toLocaleString('tr-TR')}</td>
                  <td>{t.runCount}</td>
                  <td>
                    <span className="status-chip">
                      <span className={t.status === 'ACTIVE' ? 'dot dot-online' : t.status === 'PAUSED' ? 'dot dot-busy' : 'dot dot-offline'} />
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button type="button" variant="ghost" size="sm" className="action-btn" onPress={() => toggleStatus(t)} isDisabled={Boolean(t.status === 'COMPLETED')}>
                        {t.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                      </Button>
                      <Button type="button" variant="danger" size="sm" className="action-btn action-danger" onPress={() => remove(t)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>New scheduled task</h2>
              <Button type="button" isIconOnly variant="ghost" className="modal-close" onPress={() => !busy && setOpen(false)}>
                ✕
              </Button>
            </header>

            <label className="field">
              <span>Task name</span>
              <Input
                className="field-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Daily Instagram warm-up"
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Action</span>
                <select className="field-input" value={form.jobType} onChange={(e) => setForm((f) => ({ ...f, jobType: e.target.value }))}>
                  {JOB_TYPES.map((j) => (
                    <option key={j} value={j}>
                      {j.replace('EMULATOR_', '').replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Repeat</span>
                <select className="field-input" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))}>
                  {REPEATS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Device (optional)</span>
                <select className="field-input" value={form.deviceId} onChange={(e) => setForm((f) => ({ ...f, deviceId: e.target.value }))}>
                  <option value="">— all / none —</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>First run</span>
                <input
                  type="datetime-local"
                  className="field-input"
                  value={form.nextRunAt}
                  onChange={(e) => setForm((f) => ({ ...f, nextRunAt: e.target.value }))}
                />
              </label>
            </div>

            {(form.jobType === 'EMULATOR_OPEN_APP' || form.jobType === 'EMULATOR_CLOSE_APP') && (
              <label className="field">
                <span>Package name</span>
                <Input
                  className="field-input mono"
                  value={form.packageName}
                  onChange={(e) => setForm((f) => ({ ...f, packageName: e.target.value }))}
                  placeholder="com.instagram.android"
                />
              </label>
            )}

            <footer className="modal-foot">
              <Button type="button" variant="ghost" className="btn-ghost" onPress={() => !busy && setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" className="btn-primary" isDisabled={Boolean(busy)} onPress={createTask}>
                {busy ? 'Creating…' : 'Create schedule'}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
