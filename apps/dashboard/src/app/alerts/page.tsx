import { AlertsView } from './AlertsView';

export const metadata = { title: 'Alerts · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function AlertsPage() {
  return <AlertsView />;
}
