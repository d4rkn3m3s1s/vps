'use client';

import { useEffect, useRef, useState } from 'react';

// Sayfa yenilendiğinde KAYBOLMAYAN state.
//
// ★2026-08-05 NEDEN VAR: operatör bir sohbete uzun bir mesaj yazarken sayfa
// yenilendiğinde (veya sekme kapanıp açıldığında) yazdığı her şey gidiyordu —
// panelde hiçbir yerde `localStorage`/`sessionStorage` kullanılmıyordu. Aynı şey
// seçili cihaz/sohbet için de geçerliydi: yenileme sonrası liste başa dönüyordu.
//
// `sessionStorage` kullanıyoruz (localStorage değil): taslak o SEKMEYE ait olmalı.
// İki sekmede iki farklı sohbete yazan operatörün taslakları birbirini EZMEZ, ve
// tarayıcı kapanınca eski taslaklar birikmez.
//
// SSR güvenli: ilk render'da her zaman `initial` döner (Next.js hydration uyumsuzluğu
// çıkmasın diye), depolanan değer mount'tan SONRA yüklenir.
export function usePersistedState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);

  // Mount: depodaki değeri yükle (varsa).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* bozuk JSON / depo kapalı → initial ile devam */
    }
    loaded.current = true;
  }, [key]);

  // Değişimi yaz. İlk yükleme tamamlanmadan YAZMA — aksi halde `initial` depodaki
  // gerçek değeri ezerdi (mount sırası: setValue(initial) → effect → yükle).
  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (value === undefined || value === null || value === '') sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* kota dolu / gizli mod → sessizce vazgeç, akışı bozma */
    }
  }, [key, value]);

  return [value, setValue];
}
