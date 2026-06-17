import { BillingView } from './BillingView';

export const metadata = { title: 'Billing · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function BillingPage() {
  return <BillingView />;
}
