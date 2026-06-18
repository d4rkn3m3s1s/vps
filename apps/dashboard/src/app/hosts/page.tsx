import { serverFetch } from '../../lib/serverFetch';
import { HostsView, type Host } from './HostsView';

export const metadata = { title: 'Sunucular · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function HostsPage() {
  const res = await serverFetch<Host[]>('/hosts');
  return <HostsView hosts={res?.data ?? []} />;
}
