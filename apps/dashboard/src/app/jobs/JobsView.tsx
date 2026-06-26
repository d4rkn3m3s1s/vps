'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Braces, CheckCircle2, Clock, Download, Image as ImageIcon, ListTree, Loader2, Pause, Radio, X } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat } from '../../components/hud';
import { downloadCsv } from '../../lib/csv';
import { useFleetEvents } from '../../lib/live';

export type Job = {
  id: string;
  type: string;
  status: string;
  emulatorId: string | null;
  result?: unknown;
  error?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  finishedAt?: string | null;
};

const STATUS_TR: Record<string, string> = {
  PENDING: 'Bekliyor',
  RUNNING: 'Çalışıyor',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız',
  CANCELLED: 'İptal edildi',
  QUEUED: 'Kuyrukta'
};

function statusClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'dot dot-online';
    case 'FAILED':
      return 'dot dot-error';
    case 'RUNNING':
      return 'dot dot-busy';
    case 'PENDING':
      return 'dot dot-busy';
    default:
      return 'dot dot-offline';
  }
}

// Pull a base64 screenshot out of a job result, if present.
function screenshotOf(result: unknown): string | null {
  if (result && typeof result === 'object' && 'screenshotBase64' in result) {
    const b = (result as { screenshotBase64?: unknown }).screenshotBase64;
    if (typeof b === 'string' && b.length > 0) return b;
  }
  return null;
}

export function JobsView({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<Job | null>(null);

  // Live polling: refresh the job list every 4s while enabled.
  useEffect(() => {
    if (!live) return undefined;
    const tick = async () => {
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' });
        const json = await res.json();
        if (Array.isArray(json.data)) setJobs(json.data);
      } catch {
        /* ignore transient errors */
      }
    };
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [live]);

  // Real-time: refresh immediately when a job is created or changes status.
  useFleetEvents(['job.created', 'job.updated'], () => {
    if (!live) return;
    fetch('/api/jobs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => Array.isArray(j.data) && setJobs(j.data))
      .catch(() => {});
  });

  const pending = jobs.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING').length;
  const completed = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  function exportCsv() {
    downloadCsv(
      `fleet-jobs-${jobs.length}.csv`,
      [
        { key: 'id', label: 'Görev ID' },
        { key: 'type', label: 'Tür' },
        { key: 'status', label: 'Durum' },
        { key: 'target', label: 'Hedef' },
        { key: 'createdAt', label: 'Oluşturulma' }
      ],
      jobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        target: (j.payload?.deviceId as string) ?? j.emulatorId ?? '',
        createdAt: j.createdAt
      }))
    );
  }

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="GÖREV KONSOLU"
        title="Görevler"
        subtitle={`${jobs.length} işlem · ${pending} devam ediyor`}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={exportCsv}>
              <Download size={15} /> CSV Dışa Aktar
            </button>
            <button type="button" className={live ? 'btn-primary' : 'btn-ghost'} onClick={() => setLive((v) => !v)}>
              {live ? <><Radio size={15} /> Canlı</> : <><Pause size={15} /> Duraklatıldı</>}
            </button>
          </>
        }
      />

      <div className="holo-stats-grid">
        <HoloStat
          label="Toplam İşlem"
          value={<span className="mono">{jobs.length}</span>}
          sub="kuyruktaki tüm görevler"
          tone="cyan"
          icon={<ListTree size={16} />}
        />
        <HoloStat
          label="Devam Eden"
          value={<span className="mono">{pending}</span>}
          sub="bekleyen / çalışan"
          tone="warning"
          icon={<Loader2 size={16} />}
        />
        <HoloStat
          label="Tamamlandı"
          value={<span className="mono">{completed}</span>}
          sub="başarıyla bitti"
          tone="success"
          icon={<CheckCircle2 size={16} />}
        />
        <HoloStat
          label="Başarısız"
          value={<span className="mono">{failed}</span>}
          sub="hata ile sonuçlandı"
          tone="error"
          icon={<AlertTriangle size={16} />}
        />
      </div>

      <HoloPanel title="Görev Akışı" icon={<Activity size={16} />}>
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Tür</th>
                <th>Durum</th>
                <th>Hedef</th>
                <th>Oluşturulma</th>
                <th><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="table-empty">
                      <div className="empty-art">☰</div>
                      <span>Henüz görev yok</span>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const target = (job.payload?.deviceId as string) ?? job.emulatorId ?? '—';
                  return (
                    <tr
                      key={job.id}
                      className="clickable-row"
                      tabIndex={0}
                      role="button"
                      aria-label={`${job.type} görevini görüntüle`}
                      onClick={() => setSelected(job)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(job);
                        }
                      }}
                    >
                      <td>
                        <strong>{job.type}</strong>
                        <div className="helper mono">{job.id.slice(0, 14)}</div>
                      </td>
                      <td>
                        <span className="status-chip">
                          <span className={statusClass(job.status)} />
                          {STATUS_TR[job.status] ?? job.status}
                        </span>
                      </td>
                      <td className="mono">{typeof target === 'string' ? target.slice(0, 14) : '—'}</td>
                      <td className="helper">{new Date(job.createdAt).toLocaleString('tr-TR')}</td>
                      <td className="helper">görüntüle ›</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </HoloPanel>

      {selected ? (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal modal-wide holo-panel" onClick={(e) => e.stopPropagation()}>
            <span className="holo-corner holo-corner-tl" aria-hidden />
            <span className="holo-corner holo-corner-tr" aria-hidden />
            <span className="holo-corner holo-corner-bl" aria-hidden />
            <span className="holo-corner holo-corner-br" aria-hidden />
            <header className="modal-head">
              <h2><span className="holo-panel-ico"><Activity size={16} /></span> {selected.type}</h2>
              <button type="button" className="modal-close" onClick={() => setSelected(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="fp-grid">
              <div className="fp-row"><span className="helper">Görev ID</span><span className="mono">{selected.id}</span></div>
              <div className="fp-row"><span className="helper">Durum</span><span className="status-chip"><span className={statusClass(selected.status)} /> {STATUS_TR[selected.status] ?? selected.status}</span></div>
              <div className="fp-row"><span className="helper">Oluşturulma</span><span className="mono">{new Date(selected.createdAt).toLocaleString('tr-TR')}</span></div>
              <div className="fp-row"><span className="helper">Tamamlanma</span><span className="mono">{selected.finishedAt ? new Date(selected.finishedAt).toLocaleString('tr-TR') : '—'}</span></div>
            </div>

            {selected.error ? (
              <div className="modal-section">
                <h3><AlertTriangle size={14} /> Hata</h3>
                <pre className="job-pre job-pre-error">{selected.error}</pre>
              </div>
            ) : null}

            {screenshotOf(selected.result) ? (
              <div className="modal-section">
                <h3><ImageIcon size={14} /> Ekran Görüntüsü</h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="job-shot" src={`data:image/png;base64,${screenshotOf(selected.result)}`} alt="screenshot" />
              </div>
            ) : null}

            <div className="modal-section">
              <h3><Braces size={14} /> Yük (Payload)</h3>
              <pre className="job-pre">{JSON.stringify(selected.payload ?? {}, null, 2)}</pre>
            </div>

            {selected.result && !screenshotOf(selected.result) ? (
              <div className="modal-section">
                <h3><Clock size={14} /> Sonuç</h3>
                <pre className="job-pre">{JSON.stringify(selected.result, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
