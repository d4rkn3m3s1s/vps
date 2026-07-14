import { serverFetch } from '../../lib/serverFetch';
import { ApplicationsView, type AppItem, type AppDevice, type BundledApk } from './ApplicationsView';

export const metadata = { title: 'Uygulamalar · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  const [appsRes, devicesRes, apksRes] = await Promise.all([
    serverFetch<AppItem[]>('/catalog/apps'),
    serverFetch<AppDevice[]>('/devices'),
    serverFetch<BundledApk[]>('/apks')
  ]);

  return (
    <ApplicationsView
      apps={appsRes?.data ?? []}
      devices={devicesRes?.data ?? []}
      bundledApks={apksRes?.data ?? []}
    />
  );
}
