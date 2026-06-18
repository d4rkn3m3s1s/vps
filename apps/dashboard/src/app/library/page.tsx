import { serverFetch } from '../../lib/serverFetch';
import { LibraryView, type Asset } from './LibraryView';

export const metadata = { title: 'Kütüphane · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const res = await serverFetch<Asset[]>('/library');
  return <LibraryView assets={res?.data ?? []} />;
}
