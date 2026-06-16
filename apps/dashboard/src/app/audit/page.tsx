import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export const metadata = { title: 'Audit · VPS Fleet' };
export const dynamic = 'force-dynamic';

type AuditLog = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  createdAt: string;
  user?: { email: string } | null;
};

type ApiResponse<T> = { data: T };

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.DEFAULT_API_KEY ?? '' }
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function AuditPage() {
  const res = await fetchJson<ApiResponse<AuditLog[]>>('/audit?limit=50');
  const logs = res?.data ?? [];

  return (
    <PageMotion className="page">
      <PageHeader title="Audit" subtitle="Security and activity log trail." />

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
                    <div className="empty-art">✓</div>
                    <span>No audit records yet</span>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <strong>{log.action}</strong>
                  </td>
                  <td className="mono">
                    {log.resourceType}
                    {log.resourceId ? `:${log.resourceId.slice(0, 10)}` : ''}
                  </td>
                  <td>{log.user?.email ?? 'system'}</td>
                  <td className="mono">{log.ip ?? '—'}</td>
                  <td className="helper">{new Date(log.createdAt).toLocaleString('tr-TR')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageMotion>
  );
}
