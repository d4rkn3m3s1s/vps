import { LogsView } from './LogsView';

export const metadata = { title: 'Audit log · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function LogsPage() {
  return <LogsView />;
}
