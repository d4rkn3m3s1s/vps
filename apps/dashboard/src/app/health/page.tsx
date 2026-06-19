import { HealthView } from './HealthView';

export const metadata = { title: 'Filo Sağlığı · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function HealthPage() {
  return <HealthView />;
}
