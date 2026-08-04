import { BackupsView } from './BackupsView';

export const metadata = { title: 'Yedekler · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function BackupsPage() {
  return <BackupsView />;
}
