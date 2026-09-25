'use client';

import { useEffect, useRef } from 'react';

// Kademeli çizim yardımcısı (2026-09-26): uzun listelerin sonuna konur. Kullanıcı
// sona yaklaşınca (800px önceden) `onMore` kendiliğinden çağrılır; IntersectionObserver
// yoksa ya da kullanıcı hızlı ilerlemek isterse düğme de aynı işi yapar.
// `onMore` sabit bir referans olmalı (useCallback), yoksa gözlemci her çizimde yeniden kurulur.
export function LoadMore({ hidden, onMore, unit = 'cihaz' }: { hidden: number; onMore: () => void; unit?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore();
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore]);
  return (
    <div ref={ref} className="load-more-row">
      <button type="button" className="btn-ghost" onClick={onMore}>
        Daha fazla göster · {hidden} {unit} daha
      </button>
    </div>
  );
}
