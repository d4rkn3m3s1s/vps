'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Download, ScrollText, ListChecks, Users, Boxes, Cpu } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';
import { downloadCsv } from '../../lib/csv';

type AuditLog = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  createdAt: string;
  user?: { email: string } | null;
};

export function LogsView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '200', ...(term ? { search: term } : {}) }).toString();
      const res = await fetch(`/api/audit?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      setLogs(Array.isArray(json.data) ? json.data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  function exportCsv() {
    downloadCsv(
      `fleet-audit-${logs.length}.csv`,
      [
        { key: 'action', label: 'İşlem' },
        { key: 'resourceType', label: 'Kaynak' },
        { key: 'user', label: 'Kullanıcı' },
        { key: 'ip', label: 'IP' },
        { key: 'createdAt', label: 'Zaman' }
      ],
      logs.map((l) => ({
        action: l.action,
        resourceType: l.resourceType,
        user: l.user?.email ?? 'system',
        ip: l.ip ?? '',
        createdAt: l.createdAt
      }))
    );
  }

  // Derived telemetry for the HoloStat deck (read-only over loaded logs).
  const total = logs.length;
  const distinctUsers = new Set(logs.filter((l) => l.user?.email).map((l) => l.user!.email)).size;
  const distinctResources = new Set(logs.map((l) => l.resourceType)).size;
  const systemEvents = logs.filter((l) => !l.user?.email).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="SİSTEM GÜNLÜKLERİ"
        title="Denetim kaydı"
        subtitle={`${total} kayıt · operasyonel ve güvenlik izi`}
        actions={
          <button type="button" className="btn-ghost" onClick={exportCsv} disabled={logs.length === 0}>
            <Download size={15} /> CSV Dışa Aktar
          </button>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Toplam Kayıt"
            value={<span className="mono">{total}</span>}
            sub="canlı denetim akışı"
            tone="cyan"
            icon={<ListChecks size={16} />}
          />
          <HoloStat
            label="Aktif Operatör"
            value={<span className="mono">{distinctUsers}</span>}
            sub="benzersiz kullanıcı"
            tone="cyan"
            icon={<Users size={16} />}
          />
          <HoloStat
            label="Kaynak Türü"
            value={<span className="mono">{distinctResources}</span>}
            sub="izlenen modül"
            tone="violet"
            icon={<Boxes size={16} />}
          />
          <HoloStat
            label="Sistem Olayı"
            value={<span className="mono">{systemEvents}</span>}
            sub="otomatik kayıt"
            tone="cyan"
            icon={<Cpu size={16} />}
          />
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <HoloPanel
          title="Denetim İzi"
          icon={<ScrollText size={16} />}
          actions={
            <div className="search-box" style={{ maxWidth: 320 }}>
              <span className="search-icon" aria-hidden><Search size={15} /></span>
              <input
                type="text"
                placeholder="İşlem veya kaynak ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
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
                {error ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="table-empty">
                        <span className="form-status form-status--err">Denetim kaydı yüklenemedi.</span>
                        <button type="button" className="btn-ghost" onClick={() => load(search.trim())}>
                          Tekrar dene
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : loading && logs.length === 0 ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j}><div className="skeleton skeleton-row" /></td>
                      ))}
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="table-empty">
                        <div className="empty-art">☰</div>
                        <span>Denetim kaydı yok</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {loading && (
                      <tr aria-hidden>
                        <td colSpan={5} style={{ padding: '4px 0' }}>
                          <div className="skeleton skeleton-row" />
                        </td>
                      </tr>
                    )}
                    {logs.map((l) => (
                    <tr key={l.id}>
                      <td><strong>{l.action}</strong></td>
                      <td><span className="status-chip mono"><span className="dot dot-cyan" />{l.resourceType}</span></td>
                      <td className="helper">{l.user?.email ?? 'sistem'}</td>
                      <td className="helper mono">{l.ip ?? '—'}</td>
                      <td className="helper">{new Date(l.createdAt).toLocaleString('tr-TR')}</td>
                    </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
