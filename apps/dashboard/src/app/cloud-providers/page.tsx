import { serverFetch } from '../../lib/serverFetch';
import { CloudProvidersView, type Provider } from './CloudProvidersView';

export const metadata = { title: 'Bulut Sağlayıcılar · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function CloudProvidersPage() {
  const res = await serverFetch<Provider[]>('/cloud-providers');
  return <CloudProvidersView initial={res?.data ?? []} />;
}
