import { FleetHubView, type Listing } from './FleetHubView';

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

export const metadata = { title: 'FleetHub · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function FleetHubPage() {
  const res = await fetchJson<ApiResponse<Listing[]>>('/catalog/listings');
  return <FleetHubView listings={res?.data ?? []} />;
}
