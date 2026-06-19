import { serverFetch } from '../../lib/serverFetch';
import { SynchronizerView, type SyncDevice } from './SynchronizerView';

export const metadata = { title: 'Senkronizatör · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function SynchronizerPage() {
  const res = await serverFetch<SyncDevice[]>('/devices');
  const devices = res?.data ?? [];
  return <SynchronizerView devices={devices} />;
}
