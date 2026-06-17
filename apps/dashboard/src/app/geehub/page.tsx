import { serverFetch } from '../../lib/serverFetch';
import { FleetHubView, type Listing } from './FleetHubView';

export const metadata = { title: 'FleetHub · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function FleetHubPage() {
  const res = await serverFetch<Listing[]>('/catalog/listings');
  return <FleetHubView listings={res?.data ?? []} />;
}
