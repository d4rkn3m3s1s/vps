import { serverFetch } from '../../lib/serverFetch';
import { CalendarView, type Post, type CalGroup, type CalFlow } from './CalendarView';

export const metadata = { title: 'İçerik Takvimi · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const [postsRes, groupsRes, flowsRes] = await Promise.all([
    serverFetch<Post[]>('/calendar/posts'),
    serverFetch<CalGroup[]>('/groups'),
    serverFetch<CalFlow[]>('/rpa')
  ]);

  return (
    <CalendarView
      posts={postsRes?.data ?? []}
      groups={groupsRes?.data ?? []}
      flows={flowsRes?.data ?? []}
    />
  );
}
