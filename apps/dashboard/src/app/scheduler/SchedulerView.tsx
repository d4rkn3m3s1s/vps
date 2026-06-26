'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  Plus,
  ListChecks,
  Play,
  Pause,
  Repeat,
  Activity,
  Cpu,
  X,
  Trash2,
  Clock
} from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat } from '../../components/hud';

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

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Aktif',
  PAUSED: 'Duraklatıldı',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız',
  CANCELED: 'İptal edildi'
};

const JOB_TYPE_LABEL: Record<string, string> = {
  EMULATOR_START: 'Başlat',
  EMULATOR_STOP: 'Durdur',
  EMULATOR_OPEN_APP: 'Uygulama aç',
  EMULATOR_CLOSE_APP: 'Uygulama kapat',
  EMULATOR_INSTALL_APK: 'APK yükle',
  EMULATOR_SCREENSHOT: 'Ekran görüntüsü',
  EMULATOR_SHELL: 'Kabuk komutu'
};

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
      flash({ kind: 'err', text: 'Ad ve ilk çalışma zamanı zorunludur.' });
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
      if (!res.ok) throw new Error(`Oluşturma başarısız (${res.status})`);
      setOpen(false);
      setForm({ name: '', jobType: 'EMULATOR_OPEN_APP', deviceId: '', repeat: 'DAILY', nextRunAt: '', packageName: '' });
      flash({ kind: 'ok', text: 'Zamanlanmış görev oluşturuldu.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Oluşturma başarısız' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(task: ScheduledTask) {
    const next = task.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      const res = await fetch(`/api/schedules/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!res.ok) throw new Error(`Güncelleme başarısız (${res.status})`);
      flash({ kind: 'ok', text: next === 'ACTIVE' ? 'Zamanlama sürdürüldü.' : 'Zamanlama duraklatıldı.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Güncelleme başarısız' });
    }
  }

  async function remove(task: ScheduledTask) {
    if (!confirm(`"${task.name}" zamanlaması silinsin mi?`)) return;
    try {
      const res = await fetch(`/api/schedules/${task.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Silme başarısız (${res.status})`);
      flash({ kind: 'ok', text: 'Zamanlama silindi.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Silme başarısız' });
    }
  }

  // ── Derived summary metrics (no new fetches; computed from props) ──
  const totalCount = tasks.length;
  const activeCount = tasks.filter((t) => t.status === 'ACTIVE').length;
  const pausedCount = tasks.filter((t) => t.status === 'PAUSED').length;
  const totalRuns = tasks.reduce((acc, t) => acc + t.runCount, 0);

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="ZAMANLAYICI"
        title="Zamanlayıcı"
        subtitle="Bulut telefonlarınızda otomasyon görevlerini tekrarlayan bir zamanlamayla çalıştırın."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Yeni zamanlama
          </button>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <div className="holo-stats-grid">
        <HoloStat
          label="Toplam görev"
          value={<span className="mono">{totalCount}</span>}
          sub="zamanlanmış akış"
          tone="cyan"
          icon={<ListChecks size={16} />}
        />
        <HoloStat
          label="Aktif"
          value={<span className="mono">{activeCount}</span>}
          sub="çalışmaya hazır"
          tone="success"
          icon={<Play size={16} />}
        />
        <HoloStat
          label="Duraklatılan"
          value={<span className="mono">{pausedCount}</span>}
          sub="beklemede"
          tone="warning"
          icon={<Pause size={16} />}
        />
        <HoloStat
          label="Toplam çalışma"
          value={<span className="mono">{totalRuns}</span>}
          sub="tetiklenen yürütme"
          tone="cyan"
          icon={<Activity size={16} />}
        />
      </div>

      <HoloPanel title="Zamanlanmış görevler" icon={<CalendarClock size={18} />} scan>
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Görev</th>
                <th>Tür</th>
                <th>Cihaz</th>
                <th>Tekrar</th>
                <th>Sonraki çalışma</th>
                <th>Çalışma sayısı</th>
                <th>Durum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="table-empty">
                      <div className="empty-art">
                        <Clock size={30} />
                      </div>
                      <span>Henüz zamanlanmış görev yok</span>
                    </div>
                  </td>
                </tr>
              ) : (
                tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                    </td>
                    <td className="mono helper">{JOB_TYPE_LABEL[t.jobType] ?? t.jobType}</td>
                    <td>{t.device?.name ?? '—'}</td>
                    <td>{t.repeat}</td>
                    <td className="mono">{new Date(t.nextRunAt).toLocaleString('tr-TR')}</td>
                    <td className="mono">{t.runCount}</td>
                    <td>
                      <span className="status-chip">
                        <span className={`dot ${({ ACTIVE: 'dot-online', COMPLETED: 'dot-online', PAUSED: 'dot-busy', FAILED: 'dot-error', CANCELED: 'dot-error' } as Record<string, string>)[t.status] ?? 'dot-offline'}`} />
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="action-btn" onClick={() => toggleStatus(t)} disabled={t.status === 'COMPLETED'}>
                          {t.status === 'ACTIVE' ? 'Duraklat' : 'Sürdür'}
                        </button>
                        <button type="button" className="action-btn action-danger" onClick={() => remove(t)}>
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </HoloPanel>

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>
                <span className="holo-panel-ico">
                  <CalendarClock size={18} />
                </span>{' '}
                Yeni zamanlanmış görev
              </h2>
              <button type="button" className="modal-close" onClick={() => !busy && setOpen(false)}>
                <X size={16} />
              </button>
            </header>

            <label className="field">
              <span>Görev adı</span>
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="örn. Günlük Instagram ısınması"
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Eylem</span>
                <select className="field-input" value={form.jobType} onChange={(e) => setForm((f) => ({ ...f, jobType: e.target.value }))}>
                  {JOB_TYPES.map((j) => (
                    <option key={j} value={j}>
                      {JOB_TYPE_LABEL[j] ?? j.replace('EMULATOR_', '').replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  <Repeat size={12} /> Tekrar
                </span>
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
                <span>
                  <Cpu size={12} /> Cihaz (isteğe bağlı)
                </span>
                <select className="field-input" value={form.deviceId} onChange={(e) => setForm((f) => ({ ...f, deviceId: e.target.value }))}>
                  <option value="">— tümü / hiçbiri —</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  <Clock size={12} /> İlk çalışma
                </span>
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
                <span>Paket adı</span>
                <input
                  className="field-input mono"
                  value={form.packageName}
                  onChange={(e) => setForm((f) => ({ ...f, packageName: e.target.value }))}
                  placeholder="com.instagram.android"
                />
              </label>
            )}

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setOpen(false)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={createTask}>
                {busy ? (
                  'Oluşturuluyor…'
                ) : (
                  <>
                    <CalendarClock size={16} /> Zamanlama oluştur
                  </>
                )}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
