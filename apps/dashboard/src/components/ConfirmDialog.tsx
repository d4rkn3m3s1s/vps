'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

// ★2026-07-30 Panel geneli ONAY MODALI — tarayıcının `confirm()` diyaloğunun yerine.
//
// Neden: `confirm()` tarayıcının kendi kutusunu açıyor ve başlığında SUNUCU ADRESİNİ
// gösteriyor ("125.253.73.45 web sitesinin mesajı"). Panelin tasarımıyla alakasız,
// mobilde kötü duruyor, biçimlendirme (liste/uyarı/vurgu) taşımıyor ve operatöre
// "hangi kayıt, neden riskli" bilgisini veremiyor. Ayrıca `confirm()` senkron olduğu
// için React render'ını bloke ediyor.
//
// Kullanım (mevcut `if (!confirm(...)) return;` desenine yakın kalsın diye söz-verili):
//   const { confirm, dialog } = useConfirm();
//   ...
//   if (!(await confirm({ title: 'Silinsin mi?', danger: true }))) return;
//   ...
//   return (<> ...sayfa... {dialog} </>);
//
// `dialog` JSX'i bileşenin ağacına BİR KEZ eklenmeli; aksi halde modal hiç görünmez.

export type ConfirmOptions = {
  title: string;
  /** Ana açıklama. Kısa ve eylem-odaklı olsun. */
  body?: string;
  /** Ek uyarı kutusu (sarı) — geri alınamaz / riskli durumlar için. */
  warning?: string;
  /** Onay düğmesi metni. Varsayılan: "Onayla". */
  confirmLabel?: string;
  /** Vazgeç düğmesi metni. Varsayılan: "Vazgeç". */
  cancelLabel?: string;
  /** true → onay düğmesi kırmızı (yıkıcı işlem). */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm(): { confirm: (o: ConfirmOptions) => Promise<boolean>; dialog: React.ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  // Bekleyen söz, bileşen sökülürse (unmount) asla çözülmezse çağıran sonsuza kadar
  // bekler; ref ile tutup temizlikte false çözüyoruz.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setPending({ ...o, resolve }));
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok);
      return null;
    });
  }, []);

  // Esc ile vazgeç, Enter ile onayla — klavye kullanıcısı fareye uzanmasın.
  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  // Sökülürken bekleyen sözü çöz (çağıran askıda kalmasın).
  useEffect(() => () => { pendingRef.current?.resolve(false); }, []);

  const dialog = pending ? (
    <div className="modal-overlay" onClick={() => close(false)} style={{ zIndex: 70 }}>
      <div className="modal" style={{ maxWidth: 'min(94vw, 460px)' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            {pending.danger ? <AlertTriangle size={16} color="#f87171" /> : <AlertTriangle size={16} />}
            {' '}{pending.title}
          </h2>
          <button type="button" className="modal-close" onClick={() => close(false)} aria-label="Kapat">
            <X size={16} />
          </button>
        </header>

        {pending.body ? (
          <p className="helper" style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{pending.body}</p>
        ) : null}

        {pending.warning ? (
          <div
            style={{
              border: '1px solid rgba(251,191,36,0.45)', borderLeft: '3px solid #fbbf24',
              background: 'rgba(251,191,36,0.08)', borderRadius: 10, padding: '10px 14px',
              marginBottom: 12, fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-line'
            }}
          >
            {pending.warning}
          </div>
        ) : null}

        <footer className="modal-foot">
          <button type="button" className="btn-ghost" onClick={() => close(false)}>
            {pending.cancelLabel ?? 'Vazgeç'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            autoFocus
            style={pending.danger ? { color: '#f87171', borderColor: 'rgba(248,113,113,0.45)' } : undefined}
            onClick={() => close(true)}
          >
            {pending.confirmLabel ?? 'Onayla'}
          </button>
        </footer>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
