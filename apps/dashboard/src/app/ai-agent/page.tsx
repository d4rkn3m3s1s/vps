import { apiCall } from '../../lib/apiClient';
import { AiAgentView } from './AiAgentView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Cihaz Ajanı · VPS Fleet' };

type Device = { id: string; name: string; status: string };

export default async function AiAgentPage() {
  const res = await apiCall<Device[]>('/devices', { auth: true });
  const devices = Array.isArray(res.data) ? res.data : [];
  return <AiAgentView devices={devices.map((d) => ({ id: d.id, name: d.name, status: d.status, online: d.status === 'ONLINE' }))} />;
}
