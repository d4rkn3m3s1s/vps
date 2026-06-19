import { serverFetch } from '../../lib/serverFetch';
import { RpaView, type RpaFlow, type RpaDevice } from './RpaView';

export const metadata = { title: 'RPA Stüdyo · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function RpaPage() {
  const [flowsRes, devicesRes] = await Promise.all([
    serverFetch<RpaFlow[]>('/rpa'),
    serverFetch<RpaDevice[]>('/devices')
  ]);

  return <RpaView flows={flowsRes?.data ?? []} devices={devicesRes?.data ?? []} />;
}
