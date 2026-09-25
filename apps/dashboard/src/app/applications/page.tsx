import { serverFetch } from '../../lib/serverFetch';
import { pickDevices } from '../../lib/pickDevice';
import { ApplicationsView, type AppDevice, type BundledApk } from './ApplicationsView';

export const metadata = { title: 'Uygulamalar · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  const [devicesRes, apksRes] = await Promise.all([
    serverFetch<AppDevice[]>('/devices'),
    serverFetch<BundledApk[]>('/apks')
  ]);

  return (
    <ApplicationsView
      devices={pickDevices(devicesRes?.data, ['id', 'name']) as AppDevice[]}
      bundledApks={apksRes?.data ?? []}
    />
  );
}
