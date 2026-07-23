import { ApiDocsView } from './ApiDocsView';

export const metadata = { title: 'API Dokümantasyonu · VPS Fleet' };

// Static content — no server data fetch. The view is fully client-rendered
// (search/expand/copy), so this page just mounts it.
export default function ApiDocsPage() {
  return <ApiDocsView />;
}
