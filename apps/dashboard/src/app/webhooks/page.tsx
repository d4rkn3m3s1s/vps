import { apiCall } from '../../lib/apiClient';
import { WebhooksView, type Webhook } from './WebhooksView';

export const metadata = { title: 'Webhook’lar · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const res = await apiCall<Webhook[]>('/webhooks', { auth: true });
  return <WebhooksView webhooks={res.ok && Array.isArray(res.data) ? res.data : []} />;
}
