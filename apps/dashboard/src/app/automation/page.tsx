import { serverFetch } from '../../lib/serverFetch';
import { AutomationView, type Template, type AutoDevice } from './AutomationView';

export const metadata = { title: 'Automation · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function AutomationPage() {
  const [tplRes, devicesRes] = await Promise.all([
    serverFetch<Template[]>('/catalog/templates'),
    serverFetch<AutoDevice[]>('/devices')
  ]);

  return <AutomationView templates={tplRes?.data ?? []} devices={devicesRes?.data ?? []} />;
}
