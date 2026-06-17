import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../../lib/serverFetch';
import { ProfileDetailView, type DetailDevice, type DetailHost, type DetailJob } from './ProfileDetailView';

export const dynamic = 'force-dynamic';

export default async function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deviceRes, jobsRes, hostsRes] = await Promise.all([
    serverFetch<DetailDevice>(`/devices/${id}`),
    serverFetch<DetailJob[]>('/jobs?limit=100'),
    serverFetch<DetailHost[]>('/hosts')
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
