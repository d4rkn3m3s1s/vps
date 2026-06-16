import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProfileDetailView, type DetailDevice, type DetailHost, type DetailJob } from './ProfileDetailView';

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

export const dynamic = 'force-dynamic';

export default async function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deviceRes, jobsRes, hostsRes] = await Promise.all([
    fetchJson<ApiResponse<DetailDevice>>(`/devices/${id}`),
    fetchJson<ApiResponse<DetailJob[]>>('/jobs?limit=100'),
    fetchJson<ApiResponse<DetailHost[]>>('/hosts')
  ]);

  const device = deviceRes?.data;
  if (!device) notFound();
  const hosts = hostsRes?.data ?? [];

  // Filter the job feed to this device (jobs carry deviceId in payload).
  const jobs = (jobsRes?.data ?? []).filter(
    (j) => (j.payload?.deviceId as string | undefined) === id || j.emulatorId === id
  );

  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <Link href="/profiles" className="back-link">‹ Back to Profiles</Link>
      </div>
      <ProfileDetailView device={device} jobs={jobs} hosts={hosts} />
    </>
  );
}
