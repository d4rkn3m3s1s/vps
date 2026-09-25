import { serverFetch } from '../../lib/serverFetch';
import { pickDevices } from '../../lib/pickDevice';
import { SynchronizerView, type SyncDevice } from './SynchronizerView';

export const metadata = { title: 'Senkronizatör · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function SynchronizerPage() {
  const res = await serverFetch<SyncDevice[]>('/devices');
  const devices = pickDevices(res?.data, ['id', 'name', 'status', 'androidVersion']) as SyncDevice[];
  return <SynchronizerView devices={devices} />;
}
