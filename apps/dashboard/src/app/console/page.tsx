import { ConsoleView } from './ConsoleView';

export const metadata = { title: 'Cihaz Konsolu · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function ConsolePage() {
  return <ConsoleView />;
}
