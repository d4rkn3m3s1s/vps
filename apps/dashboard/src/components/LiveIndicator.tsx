'use client';

import { useLive } from '../lib/live';

// Üst bardaki canlı-bağlantı rozeti.
//
// ★2026-07-29: eskiden yalnızca "Live / Offline" yazıyordu ve TIKLANAMIYORDU.
// Bağlantı kalıcı olarak koptuğunda (oturum süresi dolup token alınamadığında)
// kullanıcı ne olduğunu göremiyor, elle kurtarma da yapamıyordu — panel sessizce
// bayat veri gösteriyordu. Artık durum ayrıştırılmış ve kopukken rozet bir
// "yeniden bağlan" düğmesine dönüşüyor.
export function LiveIndicator() {
  const { status, reconnect } = useLive();

  if (status === 'open') {
    return (
      <span className="live-pill live-pill-on" title="Canlı bağlantı açık — cihaz olayları anında düşüyor">
        <span className="live-dot" />
        Canlı
      </span>
    );
  }

  if (status === 'connecting') {
    return (
      <span className="live-pill" title="Canlı bağlantı kuruluyor…">
        <span className="live-dot" />
        Bağlanıyor…
      </span>
    );
  }

  // Oturum geçersiz: yeniden denemek düzeltmez, yeni giriş gerekir.
  if (status === 'unauthorized') {
    return (
      <button
        type="button"
        className="live-pill"
        onClick={() => window.location.reload()}
        style={{ cursor: 'pointer', borderColor: '#f8717155', color: '#f87171' }}
        title="Oturumun süresi dolmuş — canlı bağlantı kurulamıyor. Tıklayın: sayfa yenilenip giriş ekranına gidilir."
      >
        <span className="live-dot" />
        Oturum bitti — yenile
      </button>
    );
  }

  // offline: otomatik yeniden deneniyor, ama beklemeden elle de tetiklenebilir.
  return (
    <button
      type="button"
      className="live-pill"
      onClick={reconnect}
      style={{ cursor: 'pointer', borderColor: '#fbbf2455', color: '#fbbf24' }}
      title="Canlı bağlantı kopuk — otomatik yeniden deneniyor. Beklemeden denemek için tıklayın."
    >
      <span className="live-dot" />
      Kopuk — yeniden bağlan
    </button>
  );
}
