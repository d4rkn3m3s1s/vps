import { RpaView, type RpaFlow, type RpaDevice } from './RpaView';

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

export const metadata = { title: 'RPA Studio · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function RpaPage() {
  const [flowsRes, devicesRes] = await Promise.all([
    fetchJson<ApiResponse<RpaFlow[]>>('/rpa'),
    fetchJson<ApiResponse<RpaDevice[]>>('/devices')
  ]);

  return <RpaView flows={flowsRes?.data ?? []} devices={devicesRes?.data ?? []} />;
}
