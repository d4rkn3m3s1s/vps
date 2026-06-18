import { serverFetch } from '../../lib/serverFetch';
import { WallView, type WallDevice, type WallGroup } from './WallView';

export const metadata = { title: 'Canlı Duvar · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function WallPage() {
  const [devicesRes, groupsRes] = await Promise.all([
    serverFetch<WallDevice[]>('/devices'),
    serverFetch<WallGroup[]>('/groups')
  ]);

  return <WallView devices={devicesRes?.data ?? []} groups={groupsRes?.data ?? []} />;
}
