import { SchedulerView, type ScheduledTask, type SchedulerDevice } from './SchedulerView';

type ApiResponse<T> = { data: T };

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.DEFAULT_API_KEY ?? '' }
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const metadata = { title: 'Scheduler · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function SchedulerPage() {
  const [tasksRes, devicesRes] = await Promise.all([
    fetchJson<ApiResponse<ScheduledTask[]>>('/schedules'),
    fetchJson<ApiResponse<SchedulerDevice[]>>('/devices')
  ]);

  return <SchedulerView tasks={tasksRes?.data ?? []} devices={devicesRes?.data ?? []} />;
}
