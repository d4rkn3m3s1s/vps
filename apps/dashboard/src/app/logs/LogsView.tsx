'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Download } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
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
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '200', ...(term ? { search: term } : {}) }).toString();
      const res = await fetch(`/api/audit?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      setLogs(Array.isArray(json.data) ? json.data : []);
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

  return (
    <PageMotion className="page">
      <PageHeader
        title="Denetim kaydı"
        subtitle={`${logs.length} kayıt · operasyonel ve güvenlik izi`}
        actions={
          <button type="button" className="btn-ghost" onClick={exportCsv} disabled={logs.length === 0}>
            <Download size={15} /> CSV Dışa Aktar
          </button>
        }
      />

      <div className="search-box" style={{ maxWidth: 360, marginBottom: '1rem' }}>
        <Search size={15} />
        <input
          className="search-input"
          placeholder="İşlem veya kaynak ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ border: 'none', background: 'transparent', color: 'inherit', outline: 'none', width: '100%' }}
        />
      </div>

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
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="table-empty">
                    <div className="empty-art">☰</div>
                    <span>{loading ? 'Yükleniyor…' : 'Denetim kaydı yok'}</span>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.action}</strong></td>
                  <td className="mono">{l.resourceType}</td>
                  <td className="helper">{l.user?.email ?? 'sistem'}</td>
                  <td className="helper mono">{l.ip ?? '—'}</td>
                  <td className="helper">{new Date(l.createdAt).toLocaleString('tr-TR')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageMotion>
  );
}
