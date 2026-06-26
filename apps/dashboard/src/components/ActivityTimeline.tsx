import { Rocket, Power, LogIn, KeyRound, Workflow, Activity } from 'lucide-react';

export type TimelineEvent = {
  id: string;
  action: string;
  resourceType: string;
  actor: string;
  createdAt: string;
};

// Map an audit action to an icon + human label.
function decorate(action: string): { Icon: typeof Activity; label: string } {
  if (action.includes('login')) return { Icon: LogIn, label: 'Kullanıcı giriş yaptı' };
  if (action.includes('device') && action.includes('create')) return { Icon: Rocket, label: 'Cihaz kuruldu' };
  if (action.includes('reboot') || action.includes('restart')) return { Icon: Power, label: 'Cihaz yeniden başlatıldı' };
  if (action.includes('apikey') || action.includes('api_key') || action.includes('key'))
    return { Icon: KeyRound, label: 'API anahtarı oluşturuldu' };
  if (action.includes('rpa') || action.includes('schedule') || action.includes('automation') || action.includes('job'))
    return { Icon: Workflow, label: 'Otomasyon başlatıldı' };
  return { Icon: Activity, label: action };
}

export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="tl-empty helper">Henüz etkinlik yok.</div>;
  }
  return (
    <ol className="timeline">
      {events.map((e) => {
        const { Icon, label } = decorate(e.action);
        return (
          <li className="tl-item" key={e.id}>
            <span className="tl-dot"><Icon size={14} /></span>
            <div className="tl-body">
              <div className="tl-top">
                <strong>{label}</strong>
                <span className="tl-time">{new Date(e.createdAt).toLocaleString('tr-TR')}</span>
              </div>
              <div className="tl-sub">
                {e.actor} · <span className="mono">{e.resourceType}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
