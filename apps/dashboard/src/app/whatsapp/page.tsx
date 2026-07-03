import { PageMotion } from '../../components/Motion';
import { apiCall } from '../../lib/apiClient';
import { WhatsappView } from './WhatsappView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'WhatsApp · VPS Fleet' };

type Device = { id: string; name: string; status: string };

export default async function WhatsappPage() {
  const res = await apiCall<Device[]>('/devices', { auth: true });
  const devices = Array.isArray(res.data) ? res.data : [];
  return (
    <PageMotion className="page">
      <WhatsappView
        devices={devices.map((d) => ({ id: d.id, name: d.name, online: d.status === 'ONLINE' }))}
      />
    </PageMotion>
  );
}
