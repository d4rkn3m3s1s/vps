import { BillingView } from './BillingView';

export const metadata = { title: 'Faturalama · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function BillingPage() {
  return <BillingView />;
}
