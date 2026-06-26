import { Suspense } from 'react';
import { LoginView } from './LoginView';

export const metadata = { title: 'Giriş · VPS Fleet' };

export default function LoginPage() {
  // LoginView reads ?email= via useSearchParams, which requires a Suspense
  // boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginView />
    </Suspense>
  );
}
