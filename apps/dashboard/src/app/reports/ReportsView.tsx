'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, FileJson } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
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
      <PageHeader
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

      <div className="stats">
        <div className="metric"><p className="metric-label">Aralıktaki görevler</p><p className="metric-value">{s?.jobs.inRange ?? 0}</p><p className="metric-sub">{s?.jobs.total ?? 0} toplam</p></div>
        <div className="metric"><p className="metric-label">Başarı oranı</p><p className="metric-value">{s?.jobs.successRate ?? 0}%</p><p className="metric-sub">{s?.jobs.completed ?? 0} başarılı · {s?.jobs.failed ?? 0} başarısız</p></div>
        <div className="metric"><p className="metric-label">Cihazlar</p><p className="metric-value">{s?.devices.total ?? 0}</p><p className="metric-sub">{s?.devices.online ?? 0} çevrimiçi</p></div>
        <div className="metric"><p className="metric-label">Tetiklenen uyarılar</p><p className="metric-value">{s?.alertEvents ?? 0}</p><p className="metric-sub">aralıkta</p></div>
      </div>

      <div className="panel">
        <h2>Türe göre görevler</h2>
        <div className="panel-stack">
          {!s || s.jobsByType.length === 0 ? (
            <p className="helper">Bu aralıkta görev yok.</p>
          ) : (
            s.jobsByType.map((row) => {
              const max = s.jobsByType[0]?.count || 1;
              const pct = Math.round((row.count / max) * 100);
              return (
                <div className="report-bar-row" key={row.type}>
                  <span className="report-bar-label">{row.type}</span>
                  <div className="report-bar-track">
                    <div className="report-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="report-bar-count">{row.count}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </PageMotion>
  );
}
