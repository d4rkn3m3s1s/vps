import { HostsView, type Host } from './HostsView';

type ApiResponse<T> = { data: T };

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.DEFAULT_API_KEY ?? '' }
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const metadata = { title: 'Hosts · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function HostsPage() {
  const res = await fetchJson<ApiResponse<Host[]>>('/hosts');
  return <HostsView hosts={res?.data ?? []} />;
}
