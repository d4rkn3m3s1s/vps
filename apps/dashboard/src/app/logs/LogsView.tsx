'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Download } from 'lucide-react';
import { Button, Input } from '@heroui/react';
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
        { key: 'action', label: 'Action' },
        { key: 'resourceType', label: 'Resource' },
        { key: 'user', label: 'User' },
        { key: 'ip', label: 'IP' },
        { key: 'createdAt', label: 'Time' }
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
        title="Audit log"
        subtitle={`${logs.length} entries · operational & security trail`}
        actions={
          <Button type="button" variant="ghost" className="btn-ghost" onPress={exportCsv} isDisabled={Boolean(logs.length === 0)}>
            <Download size={15} /> Export CSV
          </Button>
        }
      />

      <div className="search-box" style={{ maxWidth: 360, marginBottom: '1rem' }}>
        <Search size={15} />
        <Input
          className="search-input"
          placeholder="Search action or resource…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ border: 'none', background: 'transparent', color: 'inherit', outline: 'none', width: '100%' }}
        />
      </div>

      <div className="profile-table-wrap">
        <table className="profile-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Resource</th>
              <th>User</th>
              <th>IP</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="table-empty">
                    <div className="empty-art">☰</div>
                    <span>{loading ? 'Loading…' : 'No audit entries'}</span>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.action}</strong></td>
                  <td className="mono">{l.resourceType}</td>
                  <td className="helper">{l.user?.email ?? 'system'}</td>
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
