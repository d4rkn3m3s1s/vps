import { DistributeView } from './DistributeView';

export const metadata = { title: 'File distribution · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function DistributePage() {
  return <DistributeView />;
}
