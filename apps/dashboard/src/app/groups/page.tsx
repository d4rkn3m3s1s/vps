import { GroupsView } from './GroupsView';

export const metadata = { title: 'Device groups · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function GroupsPage() {
  return <GroupsView />;
}
