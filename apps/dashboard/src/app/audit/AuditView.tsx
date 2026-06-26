'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Download, RotateCcw, ShieldCheck, Activity, Users, Cpu, ScrollText, Filter } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';

export type AuditLog = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  createdAt: string;
  user?: { email: string } | null;
};

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function AuditView({ initialLogs }: { initialLogs: AuditLog[] }) {
  const [logs, setLogs] = useState<AuditLog[]>(initialLogs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Filters.
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const buildQuery = useCallback(
    (limit: number) => {
      const p = new URLSearchParams();
      p.set('limit', String(limit));
      if (action.trim()) p.set('action', action.trim());
      if (actor.trim()) p.set('actor', actor.trim());
      // Date inputs are yyyy-mm-dd; widen "to" to end-of-day.
      if (from) p.set('from', new Date(from).toISOString());
      if (to) p.set('to', new Date(`${to}T23:59:59`).toISOString());
      return p.toString();
    },
    [action, actor, from, to]
  );

  const apply = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/audit?${buildQuery(200)}`);
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      setLogs(Array.isArray(json.data) ? json.data : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  // Re-query when filters change (debounced).
  useEffect(() => {
    const t = setTimeout(() => void apply(), 350);
    return () => clearTimeout(t);
  }, [apply]);

  function reset() {
    setAction('');
    setActor('');
    setFrom('');
    setTo('');
  }

  // Export the currently filtered rows to a CSV download (client-side).
  function exportCsv() {
    const header = ['timestamp', 'actor', 'action', 'resourceType', 'resourceId', 'ip'];
    const lines = [header.map(csvCell).join(',')];
    for (const l of logs) {
      lines.push(
        [l.createdAt, l.user?.email ?? 'system', l.action, l.resourceType, l.resourceId ?? '', l.ip ?? '']
          .map(csvCell)
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Derived telemetry for the HoloStat deck (presentation-only).
  const uniqueActors = new Set(logs.map((l) => l.user?.email ?? 'system')).size;
  const uniqueActions = new Set(logs.map((l) => l.action)).size;
  const systemEvents = logs.filter((l) => !l.user?.email).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="DENETİM KAYDI"
        title="Denetim"
        subtitle="Güvenlik ve etkinlik kayıt izi."
        actions={
          <button type="button" className="btn-ghost" onClick={exportCsv} disabled={logs.length === 0}>
            <Download size={15} /> CSV Dışa Aktar
          </button>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Kayıt İzi"
            value={<span className="mono">{logs.length}</span>}
            sub="aktif görünüm (≤ 200)"
            tone="cyan"
            icon={<ScrollText size={16} />}
          />
          <HoloStat
            label="Aktörler"
            value={<span className="mono">{uniqueActors}</span>}
            sub="benzersiz kullanıcı"
            tone="cyan"
            icon={<Users size={16} />}
          />
          <HoloStat
            label="İşlem Türü"
            value={<span className="mono">{uniqueActions}</span>}
            sub="benzersiz eylem"
            tone="violet"
            icon={<Activity size={16} />}
          />
          <HoloStat
            label="Sistem Olayı"
            value={<span className="mono">{systemEvents}</span>}
            sub="otomatik kaynaklı"
            tone="cyan"
            icon={<Cpu size={16} />}
          />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Filtre Konsolu" icon={<Filter size={16} />}>
          <div className="audit-filters">
            <div className="search-box">
              <span className="search-icon" aria-hidden><Search size={14} /></span>
              <input type="text" placeholder="İşlem (örn. device.delete)" value={action} onChange={(e) => setAction(e.target.value)} />
            </div>
            <input className="field-input" type="text" placeholder="Kullanıcı e-postası" value={actor} onChange={(e) => setActor(e.target.value)} />
            <label className="audit-date">
              <span className="helper">Başlangıç</span>
              <input className="field-input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="audit-date">
              <span className="helper">Bitiş</span>
              <input className="field-input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button type="button" className="btn-ghost" onClick={reset} title="Filtreleri temizle">
              <RotateCcw size={14} /> Sıfırla
            </button>
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.1}>
        <HoloPanel
          title="Olay Akışı"
          icon={<ShieldCheck size={16} />}
          actions={<span className="status-chip"><span className={`dot ${loading ? 'dot-busy' : 'dot-online'}`} />{loading ? 'Senkronize…' : 'Canlı'}</span>}
        >
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>İşlem</th>
                  <th>Kaynak</th>
                  <th>Kullanıcı</th>
                  <th>IP</th>
                  <th>Zaman</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="skeleton-row">
                      <td><span className="skeleton" /></td>
                      <td><span className="skeleton" /></td>
                      <td><span className="skeleton" /></td>
                      <td><span className="skeleton" /></td>
                      <td><span className="skeleton" /></td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="table-empty">
                        <p className="form-status form-status--err">Denetim kayıtları yüklenemedi.</p>
                        <button type="button" className="btn-ghost" onClick={() => void apply()}>
                          <RotateCcw size={14} /> Tekrar dene
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="table-empty">
                        <div className="empty-art">☰</div>
                        <span>Eşleşen denetim kaydı yok</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id}>
                      <td><strong>{l.action}</strong></td>
                      <td className="mono helper">{l.resourceType}{l.resourceId ? `:${l.resourceId.slice(0, 8)}` : ''}</td>
                      <td>{l.user?.email ?? 'sistem'}</td>
                      <td className="mono helper">{l.ip ?? '—'}</td>
                      <td className="helper">{new Date(l.createdAt).toLocaleString('tr-TR')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="helper helper--note">{logs.length} kayıt gösteriliyor (en fazla 200). Dışa aktarma, filtrelenen kümeyi içerir.</p>
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
