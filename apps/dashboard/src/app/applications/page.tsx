import { serverFetch } from '../../lib/serverFetch';
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
      devices={devicesRes?.data ?? []}
      bundledApks={apksRes?.data ?? []}
    />
  );
}
