import { ConsoleView } from './ConsoleView';

export const metadata = { title: 'Device console · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default function ConsolePage() {
  return <ConsoleView />;
}
