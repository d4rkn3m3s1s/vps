import { SynchronizerView, type SyncDevice } from './SynchronizerView';

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

export const metadata = { title: 'Synchronizer · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function SynchronizerPage() {
  const res = await fetchJson<ApiResponse<SyncDevice[]>>('/devices');
  const devices = res?.data ?? [];
  return <SynchronizerView devices={devices} />;
}
