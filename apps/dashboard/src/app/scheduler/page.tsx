import { serverFetch } from '../../lib/serverFetch';
import { pickDevices } from '../../lib/pickDevice';
import { SchedulerView, type ScheduledTask, type SchedulerDevice } from './SchedulerView';

export const metadata = { title: 'Zamanlayıcı · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function SchedulerPage() {
  const [tasksRes, devicesRes] = await Promise.all([
    serverFetch<ScheduledTask[]>('/schedules'),
    serverFetch<SchedulerDevice[]>('/devices')
  ]);

  return <SchedulerView tasks={tasksRes?.data ?? []} devices={pickDevices(devicesRes?.data, ['id', 'name']) as SchedulerDevice[]} />;
}
