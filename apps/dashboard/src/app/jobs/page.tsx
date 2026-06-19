import { serverFetch } from '../../lib/serverFetch';
import { JobsView, type Job } from './JobsView';

export const metadata = { title: 'Görevler · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const res = await serverFetch<Job[]>('/jobs?limit=50');
  return <JobsView initialJobs={res?.data ?? []} />;
}
