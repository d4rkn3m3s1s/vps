'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, FileJson, BarChart3, Activity, Cpu, BellRing, Gauge, Layers } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import { downloadCsv } from '../../lib/csv';

type Summary = {
  range: { from: string; to: string };
  devices: { total: number; online: number };
  jobs: { total: number; completed: number; failed: number; pending: number; inRange: number; successRate: number };
  proxies: number;
  members: number;
  alertEvents: number;
  jobsByType: { type: string; count: number }[];
};

const RANGES = [
  { key: '7', label: 'Son 7 gün', days: 7 },
  { key: '30', label: 'Son 30 gün', days: 30 },
  { key: '90', label: 'Son 90 gün', days: 90 }
];

export function ReportsView() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  const rangeQs = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return `from=${from.toISOString()}&to=${to.toISOString()}`;
  }, [days]);

  useEffect(() => {
    fetch(`/api/reports?${rangeQs()}`)
      .then((r) => r.json())
      .then((j) => setSummary(j.data ?? null))
      .catch(() => {});
  }, [rangeQs]);

  async function exportCsv() {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports/jobs?${rangeQs()}`);
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      downloadCsv(
        `fleet-report-${days}d-${rows.length}.csv`,
        [
          { key: 'id', label: 'Görev ID' },
          { key: 'type', label: 'Tür' },
          { key: 'status', label: 'Durum' },
          { key: 'deviceId', label: 'Cihaz' },
          { key: 'createdAt', label: 'Oluşturulma' },
          { key: 'finishedAt', label: 'Tamamlanma' },
          { key: 'error', label: 'Hata' }
        ],
        rows
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportJson() {
    const res = await fetch(`/api/reports?${rangeQs()}`);
    const json = await res.json();
    const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-report-${days}d.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = summary;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="RAPORLAR"
        title="Raporlar"
        subtitle="Çalışma alanı operasyonel özeti ve dışa aktarma"
        actions={
          <>
            <select className="inline-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.days}>{r.label}</option>
              ))}
            </select>
            <button type="button" className="btn-ghost" disabled={busy} onClick={exportCsv}>
              <Download size={15} /> CSV
            </button>
            <button type="button" className="btn-ghost" onClick={exportJson}>
              <FileJson size={15} /> JSON
            </button>
          </>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            tone="info"
            icon={<Activity size={16} />}
            label="Aralıktaki görevler"
            value={<span className="mono">{s?.jobs.inRange ?? 0}</span>}
            sub={<span className="mono">{s?.jobs.total ?? 0}</span>}
          />
          <HoloStat
            tone="success"
            icon={<Gauge size={16} />}
            label="Başarı oranı"
            value={<span className="mono">{s?.jobs.successRate ?? 0}%</span>}
            sub={<><span className="mono">{s?.jobs.completed ?? 0}</span> başarılı · <span className="mono">{s?.jobs.failed ?? 0}</span> başarısız</>}
          />
          <HoloStat
            tone="cyan"
            icon={<Cpu size={16} />}
            label="Cihazlar"
            value={<span className="mono">{s?.devices.total ?? 0}</span>}
            sub={<><span className="mono">{s?.devices.online ?? 0}</span> çevrimiçi</>}
          />
          <HoloStat
            tone="warning"
            icon={<BellRing size={16} />}
            label="Tetiklenen uyarılar"
            value={<span className="mono">{s?.alertEvents ?? 0}</span>}
            sub="aralıkta"
          />
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <HoloPanel title="Türe göre görevler" icon={<BarChart3 size={16} />} scan>
          {!s || s.jobsByType.length === 0 ? (
            <p className="helper">Bu aralıkta görev yok.</p>
          ) : (
            <div className="holo-grid-auto">
              {s.jobsByType.map((row) => {
                const max = s.jobsByType[0]?.count || 1;
                const pct = Math.round((row.count / max) * 100);
                return (
                  <Holo3D className="holo-stat holo-tone-violet" max={6} key={row.type}>
                    <div className="holo-stat-top">
                      <span className="holo-stat-ico"><Layers size={16} /></span>
                      <span className="holo-stat-label">{row.type}</span>
                    </div>
                    <div className="holo-stat-value mono">{row.count}</div>
                    <div className="report-bar-track" style={{ marginTop: 10 }}>
                      <div className="report-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="holo-stat-sub mono">{pct}%</div>
                  </Holo3D>
                );
              })}
            </div>
          )}
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
