import { JobsView, type Job } from './JobsView';

export const metadata = { title: 'Jobs · VPS Fleet' };
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

export default async function JobsPage() {
  const res = await fetchJson<ApiResponse<Job[]>>('/jobs?limit=50');
  return <JobsView initialJobs={res?.data ?? []} />;
}
