import { serverFetch } from '../../lib/serverFetch';
import { AuditView, type AuditLog } from './AuditView';

export const metadata = { title: 'Denetim · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const res = await serverFetch<AuditLog[]>('/audit?limit=50');
  return <AuditView initialLogs={res?.data ?? []} />;
}
