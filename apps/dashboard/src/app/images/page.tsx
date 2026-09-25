import { serverFetch } from '../../lib/serverFetch';
import { pickDevices } from '../../lib/pickDevice';
import { ImagesView, type Snapshot, type ImgDevice, type ImgGroup } from './ImagesView';

export const metadata = { title: 'İmaj Pazarı · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function ImagesPage() {
  const [snapsRes, marketRes, devicesRes, groupsRes] = await Promise.all([
    serverFetch<Snapshot[]>('/snapshots'),
    serverFetch<Snapshot[]>('/snapshots/market'),
    serverFetch<ImgDevice[]>('/devices'),
    serverFetch<ImgGroup[]>('/groups')
  ]);

  return (
    <ImagesView
      snapshots={snapsRes?.data ?? []}
      market={marketRes?.data ?? []}
      devices={pickDevices(devicesRes?.data, ['id', 'name']) as ImgDevice[]}
      groups={groupsRes?.data ?? []}
    />
  );
}
