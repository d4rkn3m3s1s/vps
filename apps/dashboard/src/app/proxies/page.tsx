import { ProxiesView, type Proxy } from './ProxiesView';

export const metadata = { title: 'Proxies · VPS Fleet' };
export const dynamic = 'force-dynamic';

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

export default async function ProxiesPage() {
  const res = await fetchJson<ApiResponse<Proxy[]>>('/proxies');
  return <ProxiesView proxies={res?.data ?? []} />;
}
