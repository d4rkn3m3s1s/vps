import { serverFetch } from '../../lib/serverFetch';
import { MembersView, type Member } from './MembersView';

export const metadata = { title: 'Members · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const res = await serverFetch<Member[]>('/users');
  return <MembersView members={res?.data ?? []} />;
}
