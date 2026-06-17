import { serverFetch } from '../../lib/serverFetch';
import { ProxiesView, type Proxy } from './ProxiesView';

export const metadata = { title: 'Proxies · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function ProxiesPage() {
  const res = await serverFetch<Proxy[]>('/proxies');
  return <ProxiesView proxies={res?.data ?? []} />;
}
