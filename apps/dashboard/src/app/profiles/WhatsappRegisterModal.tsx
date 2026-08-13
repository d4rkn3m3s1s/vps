'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X, AlertTriangle, MessageCircle, Copy, Terminal, Image as ImageIcon } from 'lucide-react';
import { useFleetEvents } from '../../lib/live';
import { useConfirm } from '../../components/ConfirmDialog';

export type WaStep = { key: string; label: string; percent: number };

type WaProgress = {
  accountId: string;
  deviceId: string;
  jobId: string;
  step: string;
  label: string;
  percent: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  note?: string;
  shot?: string; // base64 JPEG (only over WS, never persisted)
};

type LogLine = { ts: string; step: string; percent: number; status: string; note?: string };

type Props = {
  accountId: string;
  deviceId: string;
  phoneNumber: string;
  steps: WaStep[];
  proxyCountry?: string | null;
  onClose: () => void;
};

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Geri sayım için: 1 saatten uzun süreleri sa:dk:sn göster (mmss 60+ dakikada
// "78:12" gibi okunması zor bir şey üretiyor; WhatsApp cezası 1 saat olabiliyor).
function hhmmss(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  if (h <= 0) return mmss(s);
  return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function lineColor(l: LogLine): string {
  if (l.status === 'FAILED' || (l.note ?? '').startsWith('❌')) return '#f87171';
  if ((l.note ?? '').startsWith('✓')) return '#4ade80';
  if ((l.note ?? '').startsWith('⚠')) return '#fbbf24';
  if ((l.note ?? '').startsWith('📲') || (l.note ?? '').startsWith('📸')) return '#38bdf8';
  return '#94a3b8';
}

// Map an E.164 number's calling code to an ISO-2 country (mirrors the API's
// CC_TO_ISO) so the modal can show whether the proxy exit matches the number.
const CC_TO_ISO: Record<string, string> = {
  '355': 'AL', '90': 'TR', '49': 'DE', '44': 'GB', '33': 'FR', '39': 'IT', '34': 'ES',
  '31': 'NL', '351': 'PT', '30': 'GR', '359': 'BG', '40': 'RO', '48': 'PL', '380': 'UA',
  '7': 'RU', '46': 'SE', '47': 'NO', '45': 'DK', '358': 'FI', '43': 'AT', '41': 'CH',
  '32': 'BE', '353': 'IE', '1': 'US', '55': 'BR', '52': 'MX', '54': 'AR', '91': 'IN',
  '971': 'AE', '966': 'SA', '20': 'EG', '27': 'ZA', '234': 'NG', '61': 'AU', '81': 'JP'
};
function numberCountry(phone: string): string | null {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  for (const len of [3, 2, 1]) { const cc = d.slice(0, len); if (CC_TO_ISO[cc]) return CC_TO_ISO[cc]; }
  return null;
}

export default function WhatsappRegisterModal({ accountId, deviceId, phoneNumber, steps, proxyCountry, onClose }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<WaProgress>({
    accountId,
    deviceId,
    jobId: '',
    step: 'queued',
    label: 'Kuyruğa alındı',
    percent: 3,
    status: 'RUNNING'
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // The real registration start (first log line's ts). We count elapsed from THIS,
  // not from modal-open — otherwise reopening a background run reset the clock to 00:00.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [shot, setShot] = useState<string | null>(null); // latest downscaled screenshot
  const [showShot, setShowShot] = useState(false); // "SS göster" toggle (off by default)
  const [shotBig, setShotBig] = useState(false); // click-to-enlarge
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  // ★2026-07-30 Operatör-yönlendirme durumu (API /status'tan gelir):
  //  waitUntil → WhatsApp bekletme cezasının bitiş anı; modal GERİ SAYAR.
  //  action    → "ne yapmalıyım" tek cümle.  wallKind → BAN mı geçici mi.
  //  resumable → aynı numarayla devam edilebilir mi (kurtarma butonu buna bakar).
  //  timings   → adım→saniye (hangi adımda takıldı).
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [wallKind, setWallKind] = useState<string | null>(null);
  const [resumable, setResumable] = useState(false);
  const [timings, setTimings] = useState<Record<string, number> | null>(null);
  const [remain, setRemain] = useState(0); // geri sayan saniye
  const [retryBusy, setRetryBusy] = useState(false);
  const [accStatus, setAccStatus] = useState<string | null>(null);
  // "Sıfırla ve Tekrar Dene" adım listesi: hangi kurtarma adımı GERÇEKTEN koştu.
  // Operatör geri bildirimi: "butonu süreci logları görelim" — buton bir şey yapıp
  // yapmadığını göstermeli, sessizce "başladı" demekle kalmamalı.
  const [recoverySteps, setRecoverySteps] = useState<Array<{ key: string; label: string; ok: boolean }> | null>(null);
  // ★2026-07-30 Art arda deneme uyarısı. API "bu numara son N dakikada K kez denendi"
  // diyorsa gösterilir — WhatsApp cezayı KATLIYOR (canlı: 14 dk'da 3 deneme → 1 saatlik
  // ceza 24 SAATE çıktı). Operatör kararı gereği ENGELLEMEZ, yalnızca uyarır.
  const [retryWarning, setRetryWarning] = useState<string | null>(null);
  // Panel onay modalı (tarayıcı confirm() yerine). `dialog` ağaca eklenmeli — en altta.
  const { confirm, dialog: confirmDialog } = useConfirm();
  const termRef = useRef<HTMLDivElement>(null);

  // Restore persisted history on open (covers "arka plana al" → reopen).
  //
  // ★2026-07-30 Bu artık TEK SEFERLİK DEĞİL: 15 saniyede bir tekrar okunuyor. Sebep:
  // bekleme cezası (`waitUntil`), aksiyon cümlesi (`action`), ban türü ve adım süreleri
  // job'ın `result`'ında yaşıyor — WS progress olayında YOK. Tek seferlik okumada modal
  // "1 saat bekle" cezasını hiç göremiyor, çünkü ceza modal AÇIKKEN oluşuyor.
  // Yoklama ucuz (tek satır + tek job okuması) ve yalnızca modal açıkken çalışır.
  useEffect(() => {
    let cancelled = false;
    let firstLoad = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/status`);
        const body = await res.json().catch(() => ({}));
        const d = body?.data;
        if (cancelled || !d) return;
        // Günlük ve son durum yalnızca İLK yüklemede yazılır: sonraki turlar canlı WS
        // olaylarının biriktirdiği listeyi EZMEMELİ (yoklama, canlı akışı geri saramaz).
        if (firstLoad) {
          if (Array.isArray(d.log) && d.log.length) setLogs(d.log as LogLine[]);
          if (d.lastProgress) setCurrent(d.lastProgress as WaProgress);
          const firstTs = d.startedAt ?? (Array.isArray(d.log) && d.log[0]?.ts) ?? null;
          if (firstTs) {
            const ms = Date.parse(firstTs);
            if (!Number.isNaN(ms)) setStartedAt(ms);
          }
        }
        // Yönlendirme alanları HER turda tazelenir.
        setAccStatus(typeof d.status === 'string' ? d.status : null);
        setAction(typeof d.action === 'string' && d.action ? d.action : null);
        setWallKind(typeof d.wallKind === 'string' && d.wallKind ? d.wallKind : null);
        setResumable(d.resumable === true);
        setTimings(d.timings && typeof d.timings === 'object' ? (d.timings as Record<string, number>) : null);
        if (typeof d.waitUntil === 'string') {
          const ms = Date.parse(d.waitUntil);
          // Geçmiş bir bitiş anı = ceza dolmuş → sayaç göstermeye gerek yok.
          setWaitUntil(!Number.isNaN(ms) && ms > Date.now() ? ms : null);
        } else {
          setWaitUntil(null);
        }
      } catch {
        /* geçici ağ/oturum hatası — sonraki tur yeniden dener */
      } finally {
        firstLoad = false;
      }
    };
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [accountId]);

  // Live progress: correlate by accountId (the flow spans two jobs).
  useFleetEvents(['whatsapp.register.progress'], (e) => {
    if (e.deviceId !== deviceId) return;
    const p = e.payload as WaProgress | undefined;
    if (!p || p.accountId !== accountId) return;
    const pn = p.note ?? '';
    // A heartbeat frame ('🎥 canlı') is a ~5s live-thumbnail tick, NOT a state change.
    // Update ONLY the live screenshot — never let it overwrite `current`.
    if (pn === '🎥 canlı') {
      if (p.shot) setShot(p.shot);
      return;
    }
    // ★FIX: a '📸 <label>' frame is a screenshot snapshot (snap()), NOT a state change
    // either. It was OVERWRITING `current` — so a '📸 choose_verify' frame arriving right
    // after the "🔀 Doğrulama yöntemi seçin" prompt clobbered the note → isMethodSelect
    // flipped false → the method-select BUTTONS vanished and the operator couldn't pick
    // (exact bug reported live). Treat it like a heartbeat: refresh the screenshot + log
    // it, but do NOT replace `current`/its parked-state note.
    if (pn.startsWith('📸')) {
      if (p.shot) setShot(p.shot);
      const line: LogLine = { ts: e.timestamp ?? new Date().toISOString(), step: p.step, percent: p.percent, status: p.status, note: pn };
      setLogs((prev) => [...prev, line]);
      return;
    }
    setCurrent(p);
    if (p.shot) setShot(p.shot);
    // ★2026-07-29: Kod REDDEDİLDİ bildirimi. Ajan artık yanlış kodda akışı ÖLDÜRMÜYOR
    // (eskiden FAILED olup operatör yeni kayıt açmak zorunda kalıyordu → aynı numara
    // ikinci kez denenip yanma riski). Akış OTP beklemede kalıyor; burada kutuyu
    // temizleyip uyarıyı gösteriyoruz ki operatör doğru kodu hemen girebilsin.
    if (/kabul edilmedi|kodu YANLIŞ/i.test(p.note ?? '')) {
      setOtp('');
      setOtpMsg('❌ Kod kabul edilmedi — doğru 6 haneli kodu tekrar girin.');
    }
    // First live event we ever see also anchors the clock (covers a brand-new run
    // with no persisted history yet). Only set it once — never let a later event push
    // the start forward.
    setStartedAt((prev) => prev ?? (e.timestamp ? Date.parse(e.timestamp) : Date.now()));
    if (p.note) {
      const line: LogLine = { ts: e.timestamp ?? new Date().toISOString(), step: p.step, percent: p.percent, status: p.status, note: p.note };
      // ★2026-08-01: ProvisionModal ile aynı çift-satır savunması (kök live.tsx'teki
      // çift-soketti, düzeltildi). Kalıcı geçmiş + canlı olay aynı satırı yazabilir.
      // NOT: yukarıdaki '📸' dalı bilerek KAPSAM DIŞI — ardışık aynı etiketli
      // ekran-görüntüsü kareleri MEŞRU tekrar olabilir, onları yutmak canlı görüntüyü bozar.
      setLogs((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.note === line.note && last.step === line.step) return prev;
        return [...prev, line];
      });
    }
  });

  const done = current.status === 'COMPLETED' || current.percent >= 100;
  const failed = current.status === 'FAILED';
  // OTP box appears when the flow parks at the code step. The agent parks here for
  // every "operator enters the code" case (plain SMS, code-on-other-phone, or a
  // rate-limit wait) and always reports step 'otp_wait'; keep the legacy alias too.
  const otpNote = current.note ?? '';
  // "Choose how to verify" — the agent paused on WhatsApp's method sheet and wants the
  // operator to pick SMS / Voice / Missed call (instead of the old blind guess). The
  // agent emits a "🔀 Doğrulama yöntemi seçin: …" note listing each option and whether
  // it's rate-limited ("(kısıtlı — 24 hours)"). We detect that note and, instead of the
  // OTP code box, show tappable method buttons.
  const isMethodSelect = !done && !failed && current.step === 'otp_wait' && /Doğrulama yöntemi seçin/i.test(otpNote);
  // Parse the option list out of the note so we can disable rate-limited ones. The agent
  // emits the note listing WHICHEVER options WhatsApp's sheet showed, in Turkish labels:
  // "🔀 Doğrulama yöntemi seçin: Diğer cihaz · Missed call · Receive SMS · Voice call".
  // ★FIX: (1) add 'other_device' (was missing → when the sheet only offered "Diğer cihaz"
  // + others, that option never rendered and the modal could look empty); (2) match BOTH
  // the Turkish label the agent prints AND the English WhatsApp row name, so a note in
  // either form is parsed. Each option becomes a tappable button.
  const methodOptions = useMemo(() => {
    type Kind = 'sms' | 'voice' | 'missed_call' | 'other_device';
    if (!isMethodSelect) return [] as { kind: Kind; label: string; locked: boolean; wait: string | null }[];
    const defs: { kind: Kind; label: string; re: RegExp }[] = [
      { kind: 'sms', label: 'SMS ile kod', re: /Receive SMS|SMS ile kod/i },
      { kind: 'voice', label: 'Sesli arama', re: /Voice call|Sesli arama/i },
      { kind: 'missed_call', label: 'Cevapsız çağrı', re: /Missed call|Cevapsız çağrı/i },
      { kind: 'other_device', label: 'Diğer cihaz', re: /Other device|Diğer cihaz/i }
    ];
    return defs
      .filter((d) => d.re.test(otpNote))
      .map((d) => {
        const seg = (otpNote.split(d.re)[1] || '').slice(0, 40);
        const lockM = /kısıtlı(?:\s*—\s*([^)·]+))?/i.exec(seg);
        return { kind: d.kind, label: d.label, locked: Boolean(lockM), wait: lockM?.[1]?.trim() ?? null };
      });
  }, [isMethodSelect, otpNote]);

  const awaitingOtp = !done && !failed && !isMethodSelect && (current.step === 'otp_wait' || current.step === 'otp_wait_manual');
  // Distinguish the 4 code-wait scenarios from the agent's note so the box shows the
  // right instruction instead of a generic "SMS". The note is the single source of
  // truth (agent emits a 📲 note; API mirrors it into the account).
  const otpIsOtherPhone = /diğer telefon|other phone|başka bir cihaz/i.test(otpNote);
  // Rate-limit'e ÖZGÜ kalıplar. NOT: geniş "bekle" KULLANMA — normal SMS note'u
  // ("SMS kodu bekleniyor") "bekleniyor" içerir ve yanlışlıkla rate-limit sanılırdı.
  const otpIsRateLimit = /\d+\s*(saat|hours?|dakika|minutes?)|Send SMS in|kısıtl|too many|geçici (olarak )?bekle|N saat/i.test(otpNote);
  const otpHint = otpIsOtherPhone
    ? { icon: '📲', title: 'Kod DİĞER TELEFONDA', body: `${phoneNumber} numarası zaten bir WhatsApp hesabına kayıtlı. 6 haneli kod SMS'e DEĞİL, o numaranın kayıtlı olduğu telefondaki WhatsApp'a gönderildi. Kodu o cihazdan okuyup buraya girin.` }
    : otpIsRateLimit
      ? { icon: '⏳', title: 'Geçici bekleme (rate-limit)', body: otpNote || `${phoneNumber} için WhatsApp geçici bekleme koydu. Süre dolunca kod gelir; geldiğinde buraya girin.` }
      : { icon: '📲', title: 'SMS doğrulama kodu bekleniyor', body: `${phoneNumber} numarasına SMS ile 6 haneli kod gelecek. Kod gelince buraya girin, ajan otomatik girer.` };

  // Tick the elapsed clock off the REAL start (startedAt) so it reflects true wall-time
  // since the registration began — surviving modal close/reopen and page reloads. When
  // we don't know the start yet (very first render before any event/history), fall back
  // to a local +1 counter so the timer still moves.
  useEffect(() => {
    if (done || failed) return;
    const tick = () => {
      if (startedAt) setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      else setElapsed((v) => v + 1);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [done, failed, startedAt]);

  // ★2026-07-30 GERİ SAYAN bekleme sayacı. `elapsed` tick'inden AYRI tutuluyor çünkü o
  // done/failed olunca duruyor — oysa bekleme cezası genelde BAŞARISIZ/parked bir kayıtta
  // görülür ve tam o zaman geri sayması gerekir. Süre dolduğunda sayacı gizle (waitUntil
  // null) ki "Tekrar Dene" butonu kilitten çıksın.
  useEffect(() => {
    if (!waitUntil) { setRemain(0); return; }
    const tick = () => {
      const left = Math.ceil((waitUntil - Date.now()) / 1000);
      if (left <= 0) { setRemain(0); setWaitUntil(null); return; }
      setRemain(left);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [waitUntil]);

  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs.length]);

  const activeIdx = useMemo(
    () => Math.max(0, steps.findIndex((s) => s.key === current.step)),
    [steps, current.step]
  );

  const barColor = failed ? '#ef4444' : done ? '#22c55e' : isMethodSelect ? '#8b5cf6' : awaitingOtp ? '#38bdf8' : 'var(--accent, #6366f1)';

  // ★2026-07-30 Tekrar deneme YALNIZCA numara sağlamsa sunulur.
  //  - KESİN BAN (wallKind BAN veya notta [YASAKLI]) → asla: tekrar denemek yalnızca zarar.
  //  - Hesap zaten ACTIVE → asla: yeni kayıt o hesabı SİLER.
  //  - Diğer başarısızlıklar (geçici engel, SMS gönderilemedi, cihaz-izi, zaman aşımı) →
  //    sunulur. `resumable` sunucudan geldiğinde ona güvenilir; gelmediyse (eski job
  //    kayıtları, henüz güncellenmemiş sonuç) ban olmayan her başarısızlık denenebilir
  //    sayılır — operatörü seçeneksiz bırakmamak, fazladan bir buton göstermekten iyidir.
  const isBanned = wallKind === 'BAN' || /\[YASAKLI\]/.test(current.note ?? '') || /\[YASAKLI\]/.test(action ?? '');
  const canRetry = !isBanned && accStatus !== 'ACTIVE' && (resumable || failed);

  // Cancel a stuck/blocked registration: flips the account to FAILED and clears the
  // device's WA-registration badge (API cancel handler), so the card stops showing
  // "Kod bekleniyor" and the WhatsApp button unlocks. Needed for terminal cases the
  // operator can't act on (number blocked / wall / wrong number) where there's no code
  // to enter.
  async function cancelRegistration() {
    if (cancelBusy) return;
    // ★2026-07-30 Tarayıcı confirm() yerine panel modalı (sunucu adresini gösteren
    // "125.253.73.45 web sitesinin mesajı" kutusu yerine).
    const ok = await confirm({
      title: 'Kayıt iptal edilsin mi?',
      body: `${phoneNumber} için WhatsApp kaydı iptal edilecek.`,
      warning: 'Hesap BAŞARISIZ işaretlenir ve cihazın kilidi açılır. Numara yanmaz ama bu kayıt kapanır — aynı numarayla devam etmek istiyorsanız "Sıfırla ve Tekrar Dene" daha iyidir.',
      confirmLabel: 'Kaydı iptal et',
      danger: true
    });
    if (!ok) return;
    setCancelBusy(true);
    try {
      const res = await fetch(`/api/accounts/batch/accounts/${accountId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setOtpMsg(b?.data?.message || b?.error || 'İptal edilemedi');
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setOtpMsg('İptal edilemedi (ağ hatası)');
    } finally {
      setCancelBusy(false);
    }
  }

  // ★2026-07-30 "Sıfırla ve Tekrar Dene". AYNI hesap satırıyla yeniden dener: API çıkış
  // IP'sini döndürür (yeni sessid) ve kayıt işini tekrar gönderir; ajan kayıt başında
  // WhatsApp verisini zaten `pm clear` ile temizliyor. Yeni kayıt AÇMAZ — böylece aynı
  // numara WhatsApp'ın çok-deneme sayacına ikinci kez "yeni kayıt" olarak yazılmaz.
  // ★★★2026-08-13 keepWaData (operatör isteği): "Hatada WhatsApp'ı SIFIRLAMASIN ki
  // ekrandan elle müdahale edebileyim." keepWaData=true çağrısında WA verisi KORUNUR
  // ve cihaz kimliği de YENİLENMEZ (kimliği değiştirmek ayakta kalan oturumu bozar);
  // yalnızca çıkış IP'si yenilenir. Tam sıfırlama ayrı bir buton olarak durur.
  async function retryRegistration(keepWaData = false) {
    if (retryBusy) return;
    if (remain > 0) {
      setOtpMsg(`Bekleme süresi dolmadı — ${hhmmss(remain)} kaldı. Erken denemek cezayı UZATIR.`);
      return;
    }
    const okRetry = await confirm({
      title: keepWaData ? 'WhatsApp’ı koruyarak devam et' : 'Sıfırla ve tekrar dene',
      body: keepWaData
        ? `${phoneNumber} için kayıt, WhatsApp SİLİNMEDEN devam ettirilecek:\n` +
          '• WhatsApp verisi KORUNUR — ekran kaldığı yerde kalır\n' +
          '• Cihaz kimliği DEĞİŞMEZ (oturumu bozmamak için)\n' +
          "• Yalnızca çıkış IP'si (proxy oturumu) yenilenir\n" +
          '• Canlı ekrandan ELLE müdahale edebilirsiniz'
        : `${phoneNumber} için kayıt sıfırlanıp tekrar denenecek:\n` +
          '• Cihazın WhatsApp verisi silinir\n' +
          "• Çıkış IP'si (proxy oturumu) yenilenir\n" +
          '• Cihaz kimliği yenilenir (IMEI / android_id / seri / MAC)\n' +
          '• AYNI numarayla yeni bir deneme başlar',
      warning: keepWaData
        ? 'WhatsApp verisi SİLİNMEZ. Ekranda takılı bir diyalog varsa (ör. "kod yanlış") canlı ekrandan kendiniz kapatabilirsiniz.'
        : 'Numara yanmaz — yeni kayıt AÇILMAZ, aynı kayıt devam eder. Bekleme cezası sürüyorsa süre dolmadan denemeyin.',
      confirmLabel: keepWaData ? 'Koruyarak devam et' : 'Sıfırla ve dene'
    });
    if (!okRetry) return;
    setRetryBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/retry`, {
        method: 'POST',
        ...(keepWaData
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepWaData: true }) }
          : {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // ★★2026-08-13 SEBEBİ GÖSTER. Eskiden mesaj bulunamayınca genel bir metin
        // yazılıyordu (proxy route error alanını hiç iletmiyordu) → operatör "buton
        // çalışmıyor" sanıyordu. En sık sebep: cihazda hâlâ bir iş sürüyor
        // (409 DEVICE_BUSY) — bu GEÇİCİ bir durumdur, ne yapılacağını da yazıyoruz.
        const reason: string =
          body?.error || body?.data?.message || body?.message || 'Tekrar deneme başlatılamadı';
        const code: string = body?.code || '';
        setOtpMsg(
          code === 'DEVICE_BUSY'
            ? `⏳ ${reason} — cihazda süren işlem bitince buton çalışacak (birkaç saniye).`
            : code === 'WAIT_IN_PROGRESS'
              ? `⏳ ${reason}`
              : `❌ ${reason}`
        );
        return;
      }
      // Kurtarma adımlarının GERÇEKTEN koşup koşmadığını göster (API bildiriyor).
      const steps = Array.isArray(body?.data?.recoverySteps) ? body.data.recoverySteps : null;
      setRecoverySteps(steps);
      setRetryWarning(typeof body?.data?.recentAttemptWarning === 'string' ? body.data.recentAttemptWarning : null);
      const failed = steps ? steps.filter((s: { ok: boolean }) => !s.ok).length : 0;
      setOtpMsg(
        failed > 0
          ? `🔄 Tekrar deneme başladı — ${failed} adım atlandı (aşağıda).`
          : '🔄 Tekrar deneme başladı — tüm kurtarma adımları uygulandı.'
      );
      // Panel durumunu hemen "çalışıyor"a çevir; ilerleme WS'ten akmaya devam eder.
      setCurrent((c) => ({ ...c, step: 'reset', label: 'Sıfırlanıyor ve tekrar deneniyor', percent: 5, status: 'RUNNING' }));
      setWaitUntil(null);
      setAction(null);
      router.refresh();
    } catch {
      setOtpMsg('Tekrar deneme başlatılamadı (ağ hatası)');
    } finally {
      setRetryBusy(false);
    }
  }

  function copyLogs() {
    const text = logs.map((l) => `${l.step}▸ ${l.note ?? l.step}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function submitOtp() {
    const code = otp.replace(/\D/g, '');
    if (otpBusy || code.length < 4) { setOtpMsg('6 haneli kodu girin'); return; }
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otpCode: code })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setOtpMsg(body?.data?.message || body?.error || 'Kod gönderilemedi'); return; }
      setOtpMsg('Kod gönderildi — ajan giriyor…');
      setOtp('');
      // The OTP job re-dispatches; progress keeps flowing on the same accountId.
      setCurrent((c) => ({ ...c, step: 'otp', label: 'SMS kodu giriliyor', percent: 90, status: 'RUNNING' }));
    } catch {
      setOtpMsg('Kod gönderilemedi (ağ hatası)');
    } finally {
      setOtpBusy(false);
    }
  }

  // Operator picked a verification method (SMS / Voice / Missed call). Re-dispatch so
  // the agent selects that row on the sheet and continues.
  async function submitMethod(kind: 'sms' | 'voice' | 'missed_call' | 'other_device') {
    if (otpBusy) return;
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/verify-method`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: kind })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setOtpMsg(body?.data?.message || body?.error || 'Yöntem gönderilemedi'); return; }
      setOtpMsg('Yöntem seçildi — ajan devam ediyor…');
      setCurrent((c) => ({ ...c, step: 'verify', label: 'Doğrulama yöntemi uygulanıyor', percent: 80, status: 'RUNNING' }));
    } catch {
      setOtpMsg('Yöntem gönderilemedi (ağ hatası)');
    } finally {
      setOtpBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* ★2026-08-01 ALT KISIM KESİLİYORDU: .modal'ın KENDİSİ scroll ediyordu, yani
          günlük uzayınca başlık VE alt butonlar ("Kaydı İptal Et" / "Arka planda devam
          et") görünürün dışına itiliyordu. modal-sticky ile iskelet 3 parçaya ayrıldı:
          başlık sabit · SADECE gövde scroll · alt bar sabit. Böylece butonlar her zaman
          erişilebilir kalıyor (mobilde de, PC'de de). */}
      <div className="modal modal-sticky" style={{ maxWidth: 'min(96vw, 640px)' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><MessageCircle size={16} /> WhatsApp kaydı · {phoneNumber}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="modal-scroll">

        {/* Proxy exit vs number-country check. WhatsApp bans a mismatch ("Login not
            available"), so surface it up front: green when the exit country matches the
            number, red when it doesn't, neutral when no proxy is attached yet. */}
        {(() => {
          const numCc = numberCountry(phoneNumber);
          // Prefer the agent's LIVE verified exit country over the static proxyCountry
          // prop. The agent tests the real exit IP at register-start and logs e.g.
          // "✓ Çıkış IP: 5.27.42.25 (TR, Istanbul) — numara ülkesiyle eşleşti"; the prop
          // is only the provision-time hint and is often empty on a fresh device, which
          // made the modal wrongly say "atanmadı" even though the agent DID route TR.
          const liveLine = [...logs].reverse().find((l) => /Çıkış IP/i.test(l.note ?? ''));
          const liveExit = liveLine ? (liveLine.note?.match(/\(([A-Z]{2})(?:,|\))/)?.[1] ?? null) : null;
          const exit = liveExit || ((proxyCountry ?? '').toUpperCase() || null);
          if (!exit) {
            return (
              <div className="proxy-check proxy-check-warn">
                <AlertTriangle size={14} /> Proxy çıkışı henüz doğrulanmadı — kayıt başlayınca agent gerçek çıkış IP'sini kontrol eder.
              </div>
            );
          }
          const match = numCc ? exit === numCc : true;
          return (
            <div className={`proxy-check ${match ? 'proxy-check-ok' : 'proxy-check-err'}`}>
              {match ? <Check size={14} /> : <AlertTriangle size={14} />}
              {match
                ? <>Proxy çıkışı <b>{exit}</b>{liveExit ? ' (doğrulandı)' : ''} · numara ({numCc ?? '—'}) ile eşleşiyor ✓</>
                : <>UYUMSUZLUK: proxy çıkışı <b>{exit}</b> ama numara <b>{numCc}</b> — WhatsApp banlar!</>}
            </div>
          );
        })()}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span>{current.label}</span>
          <span style={{ opacity: 0.65 }}>%{current.percent} · {mmss(elapsed)}</span>
        </div>
        <span className="health-bar" style={{ display: 'block', marginBottom: 14 }}>
          <span className="health-bar-fill" style={{ width: `${current.percent}%`, background: barColor }} />
        </span>

        {/* ★2026-07-30 GERİ SAYAN bekleme sayacı. WhatsApp "1 saat bekle" / "31 dakika
            bekle" dediğinde operatör kalan süreyi TAM olarak görür ve süre dolmadan
            tekrar denemeye çalışmaz (erken deneme cezayı uzatıyor). Sayaç, cezanın
            okunduğu andan itibaren sunucuda hesaplanan bitiş anına göre akar — modal
            kapanıp açılsa, sayfa yenilense bile doğru kalır. */}
        {remain > 0 && (
          <div
            style={{
              border: '1px solid rgba(251,191,36,0.45)',
              borderLeft: '3px solid #fbbf24',
              background: 'rgba(251,191,36,0.08)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 92 }}>
              <span
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 26,
                  fontWeight: 700,
                  color: '#fbbf24',
                  lineHeight: 1.1,
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {hhmmss(remain)}
              </span>
              <span style={{ fontSize: 10, opacity: 0.7, letterSpacing: 0.5 }}>KALAN SÜRE</span>
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              <strong>⏳ WhatsApp bekletiyor — kayıt İPTAL EDİLMEDİ.</strong>
              <div style={{ opacity: 0.85, marginTop: 3 }}>
                Numara yanmadı. Süre dolunca aşağıdaki <b>Sıfırla ve Tekrar Dene</b> ile aynı numarayla devam
                edin. Erken denemek cezayı uzatır.
              </div>
            </div>
          </div>
        )}

        {/* Ne yapmalıyım — her durum için tek cümle. Ajanın/API'nin ürettiği `action`
            alanı; ban ise kırmızı, geçici engel ise sarı. (Operatör geri bildirimi:
            "uyarılar bazen yarım kalıyor" — sebep ile aksiyon artık ayrı gösteriliyor.) */}
        {action && remain <= 0 && (
          <div
            style={{
              border: `1px solid ${wallKind === 'BAN' ? 'rgba(239,68,68,0.45)' : 'rgba(56,189,248,0.4)'}`,
              borderLeft: `3px solid ${wallKind === 'BAN' ? '#ef4444' : '#38bdf8'}`,
              background: wallKind === 'BAN' ? 'rgba(239,68,68,0.08)' : 'rgba(56,189,248,0.08)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 14,
              fontSize: 12.5,
              lineHeight: 1.5
            }}
          >
            <strong>{wallKind === 'BAN' ? '⛔ Ne yapmalı' : '➡️ Ne yapmalı'}</strong>
            <div style={{ opacity: 0.9, marginTop: 3 }}>{action}</div>
          </div>
        )}

        {/* ★2026-07-30 ART ARDA DENEME UYARISI. WhatsApp aynı numaraya kısa aralıkla
            yapılan denemelerde bekleme cezasını KATLIYOR — canlıda 14 dakikada 3 deneme
            1 saatlik cezayı 24 SAATE çıkardı. Kaydı ENGELLEMEZ (operatör kararı), ama
            görünür uyarır ki ceza katlanması farkında olmadan tetiklenmesin. */}
        {retryWarning && (
          <div
            style={{
              border: '1px solid rgba(251,191,36,0.4)',
              borderLeft: '3px solid #fbbf24',
              background: 'rgba(251,191,36,0.08)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 14,
              fontSize: 12,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              lineHeight: 1.65
            }}
          >
            <AlertTriangle size={14} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ opacity: 0.92 }}>{retryWarning}</span>
          </div>
        )}
        {/* ★2026-07-30 Kurtarma adımı logları. "Sıfırla ve Tekrar Dene"ye basıldığında
            hangi adımın GERÇEKTEN koştuğu görünür — buton sessizce "başladı" demekle
            kalmaz. Bir adım atlandıysa (ör. proxy yoksa IP yenilenemez) operatör bunu
            görür ve gerekirse başka bir şey dener. */}
        {recoverySteps && recoverySteps.length > 0 && (
          <div
            style={{
              border: '1px solid rgba(148,163,184,0.35)',
              borderLeft: '3px solid #64748b',
              background: 'rgba(148,163,184,0.07)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 14,
              fontSize: 12
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>🔄 Kurtarma adımları</div>
            {recoverySteps.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7, lineHeight: 1.7 }}>
                {s.ok ? <Check size={13} color="#22c55e" /> : <AlertTriangle size={13} color="#fbbf24" />}
                <span style={{ opacity: s.ok ? 0.9 : 0.7 }}>{s.label}</span>
              </div>
            ))}
            <div style={{ opacity: 0.55, marginTop: 6, fontSize: 11 }}>
              ⓘ MAC adresi cihaz yeniden başlatıldığında geçerli olur (LXC ayarında saklanır).
            </div>
          </div>
        )}

        {/* OTP box — appears when the flow parks at the code step. The instruction
            adapts to the scenario (plain SMS / code-on-other-phone / rate-limit). */}
        {isMethodSelect && (
          <div style={{ border: '1px solid rgba(139,92,246,0.4)', borderLeft: '3px solid #8b5cf6', background: 'rgba(139,92,246,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              🔀 <strong>Doğrulama yöntemi seçin</strong>
              <div style={{ opacity: 0.85, marginTop: 4, lineHeight: 1.4 }}>
                {phoneNumber} için WhatsApp bir yöntem seçmenizi istiyor. Erişebildiğiniz kanalı seçin — ajan onu uygulayıp devam eder.
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {methodOptions.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  className="btn-primary"
                  disabled={otpBusy || o.locked}
                  title={o.locked ? `Kısıtlı${o.wait ? ` — ${o.wait}` : ''}` : `${o.label} ile doğrula`}
                  onClick={() => void submitMethod(o.kind)}
                  style={{ opacity: o.locked ? 0.5 : 1 }}
                >
                  {o.kind === 'sms' ? '💬' : o.kind === 'voice' ? '📞' : '📱'} {o.label}
                  {o.locked ? ` (kısıtlı${o.wait ? ` — ${o.wait}` : ''})` : ''}
                </button>
              ))}
            </div>
            {otpMsg ? <div style={{ fontSize: 12, marginTop: 8, color: otpMsg.startsWith('Yöntem seçildi') ? '#4ade80' : '#f87171' }}>{otpMsg}</div> : null}
          </div>
        )}

        {awaitingOtp && (
          <div style={{ border: `1px solid ${otpIsRateLimit ? 'rgba(251,191,36,0.45)' : 'rgba(56,189,248,0.4)'}`, borderLeft: `3px solid ${otpIsRateLimit ? '#fbbf24' : '#38bdf8'}`, background: otpIsRateLimit ? 'rgba(251,191,36,0.08)' : 'rgba(56,189,248,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {otpHint.icon} <strong>{otpHint.title}</strong>
              <div style={{ opacity: 0.85, marginTop: 4, lineHeight: 1.4 }}>{otpHint.body}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field-input"
                inputMode="numeric"
                maxLength={8}
                placeholder="6 haneli kod"
                value={otp}
                autoFocus
                onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitOtp(); }}
                style={{ flex: 1, letterSpacing: 4, textAlign: 'center', fontSize: 16 }}
              />
              <button type="button" className="btn-primary" disabled={otpBusy || otp.replace(/\D/g, '').length < 4} onClick={submitOtp}>
                {otpBusy ? '…' : 'Gir'}
              </button>
            </div>
            {otpMsg ? <div style={{ fontSize: 12, marginTop: 6, color: otpMsg.startsWith('Kod gönderildi') ? '#4ade80' : '#f87171' }}>{otpMsg}</div> : null}
          </div>
        )}

        {/* Live terminal */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.7 }}>
            <Terminal size={13} /> Canlı kayıt günlüğü
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={() => setShowShot((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <ImageIcon size={12} /> {showShot ? 'SS gizle' : 'SS göster'}
            </button>
            <button
              type="button"
              onClick={copyLogs}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <Copy size={12} /> {copied ? 'Kopyalandı' : 'Kopyala'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div
            ref={termRef}
            style={{
              flex: '1 1 220px',
              minWidth: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.55,
              background: '#0b1020',
              color: '#94a3b8',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '10px 12px',
              height: 220,
              overflowY: 'auto',
              marginBottom: 14,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {logs.length === 0 ? (
              <span style={{ opacity: 0.5 }}>Kayıt başlatılıyor…</span>
            ) : (
              logs.map((l, i) => (
                <div key={i} style={{ color: lineColor(l) }}>
                  <span style={{ opacity: 0.45 }}>{l.step}▸ </span>
                  {l.note}
                </div>
              ))
            )}
            {!done && !failed && !awaitingOtp && (
              <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Loader2 size={12} className="spin" /> çalışıyor…
              </div>
            )}
          </div>

          {/* Optional live screenshot (SS göster) */}
          {showShot && (
            <div style={{ flex: '1 1 120px', maxWidth: 180, marginBottom: 14 }}>
              {shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/jpeg;base64,${shot}`}
                  alt="cihaz ekranı"
                  onClick={() => setShotBig(true)}
                  style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', cursor: 'zoom-in', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: 220, borderRadius: 8, border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, opacity: 0.5, textAlign: 'center', padding: 8 }}>
                  Ekran görüntüsü bekleniyor…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Enlarged screenshot overlay */}
        {shotBig && shot && (
          <div className="modal-overlay" onClick={() => setShotBig(false)} style={{ zIndex: 60 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/jpeg;base64,${shot}`} alt="cihaz ekranı" style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: 10, cursor: 'zoom-out' }} onClick={() => setShotBig(false)} />
          </div>
        )}

        {/* Step list (compact) — auto-fit so it drops to a single column on narrow phones. */}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 16px' }}>
          {steps
            .filter((s) => s.key !== 'queued')
            .map((s) => {
              const idx = steps.findIndex((x) => x.key === s.key);
              const isDone = done || idx < activeIdx || current.percent >= s.percent;
              const isActive = !done && !failed && idx === activeIdx;
              // ★2026-07-30 Adım süresi. Ajan her adımın süresini `timings` içinde
              // gönderiyor (ms); hangi adımın yavaş olduğu/nerede takıldığı isimden
              // değil SAYIDAN anlaşılsın. 10 sn'nin altındakileri göstermiyoruz —
              // hızlı adımlar listeyi gürültüye çevirirdi.
              const ms = timings?.[s.key];
              const secs = typeof ms === 'number' ? Math.round(ms / 1000) : 0;
              return (
                <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isDone || isActive ? 1 : 0.4 }}>
                  <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>
                    {isDone ? (
                      <Check size={14} color="#22c55e" />
                    ) : isActive ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.4 }} />
                    )}
                  </span>
                  <span style={{ fontSize: 12 }}>{s.label}</span>
                  {secs >= 10 ? (
                    <span
                      style={{ fontSize: 10.5, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}
                      title={`${s.label} adımı ${secs} saniye sürdü`}
                    >
                      {secs >= 60 ? `${Math.floor(secs / 60)}dk${secs % 60 ? ` ${secs % 60}sn` : ''}` : `${secs}sn`}
                    </span>
                  ) : null}
                </li>
              );
            })}
        </ol>

        {/* ★2026-07-30 Adım listesinde KARŞILIĞI OLMAYAN ama süre harcayan fazlar
            (ör. `downgrade` — Business hesabı devre dışı bırakma, canlı ölçümde 38 sn).
            Adım listesi bunları göstermediği için toplam süreyle adım süreleri
            toplamı arasında açıklanamayan bir fark oluşuyordu. */}
        {(() => {
          if (!timings) return null;
          const known = new Set(steps.map((s) => s.key));
          const extras = Object.entries(timings)
            .filter(([k, v]) => !known.has(k) && typeof v === 'number' && v >= 10_000)
            .sort((a, b) => b[1] - a[1]);
          if (!extras.length) return null;
          const LABELS: Record<string, string> = {
            downgrade: 'Business hesabı devre dışı',
            install: 'APK kurulumu',
            wipe: 'WhatsApp verisi silme',
            boot: 'Cihaz açılışı'
          };
          return (
            <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {extras.map(([k, v]) => {
                const secs = Math.round(v / 1000);
                return (
                  <span key={k} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    + {LABELS[k] ?? k}: {secs >= 60 ? `${Math.floor(secs / 60)}dk ${secs % 60}sn` : `${secs}sn`}
                  </span>
                );
              })}
            </div>
          );
        })()}
        </div>{/* /modal-scroll — buradan sonrası SABİT alt bar */}

        <footer className="modal-foot">
          {done ? (
            <>
              <span style={{ color: '#22c55e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={18} /> WhatsApp hesabı hazır
              </span>
              <button type="button" className="btn-primary" onClick={onClose}>Kapat</button>
            </>
          ) : failed ? (
            // ★2026-07-30 BAŞARISIZ ≠ ÇÖP. Kesin ban dışındaki başarısızlıklarda (geçici
            // engel, SMS gönderilemedi, cihaz-izi duvarı) numara sağlamdır → aynı hesap
            // satırıyla tekrar deneme sunuluyor. Eskiden tek seçenek "Kapat" idi ve
            // operatör SIFIRDAN yeni kayıt açmak zorunda kalıyordu (= aynı numaranın
            // ikinci denemesi = WhatsApp'ın çok-deneme sayacı → ban).
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 180px', minWidth: 0 }}>
                <AlertTriangle size={18} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.note?.slice(0, 60) || 'Kayıt başarısız'}</span>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* ★★★2026-08-13 (operatör isteği) "Hatada WhatsApp'ı sıfırlamasın ki
                    ekrandan elle müdahale edeyim". Bu buton WA verisini KORUR ve cihaz
                    kimliğine DOKUNMAZ — yalnızca çıkış IP'si yenilenir. Tam sıfırlama
                    yandaki butonda durur; hangisinin ne yaptığı onay kutusunda yazıyor.
                    ⚠️ onClick'te ok fonksiyonu ŞART: `onClick={retryRegistration}` React
                    event nesnesini ilk argüman olarak geçirir ve keepWaData TRUTHY olur. */}
                {canRetry && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={retryBusy || remain > 0}
                    onClick={() => { void retryRegistration(true); }}
                    title={
                      remain > 0
                        ? `Bekleme süresi dolmadı — ${hhmmss(remain)} kaldı`
                        : 'WhatsApp verisini KORU — ekran kaldığı yerde kalsın, elle müdahale edebileyim'
                    }
                  >
                    {retryBusy ? 'Devam ediliyor…' : remain > 0 ? `▶ Devam Et (${hhmmss(remain)})` : '▶ WhatsApp’ı Koruyarak Devam Et'}
                  </button>
                )}
                {canRetry && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={retryBusy || remain > 0}
                    onClick={() => { void retryRegistration(false); }}
                    title={
                      remain > 0
                        ? `Bekleme süresi dolmadı — ${hhmmss(remain)} kaldı`
                        : "WhatsApp verisini SİL, çıkış IP'sini ve cihaz kimliğini yenile, AYNI numarayla tekrar dene"
                    }
                  >
                    {retryBusy ? 'Sıfırlanıyor…' : '🔄 Sıfırla ve Tekrar Dene'}
                  </button>
                )}
                {/* ★2026-07-30 BAŞARISIZ DURUMDA DA "Kaydı İptal Et" (operatör isteği:
                    "Kapat kaydı iptal et de olmalı"). "Kapat" yalnızca modalı kapatır —
                    hesap AWAITING/FAILED'de kalır ve cihaz kartındaki WhatsApp butonu
                    KİLİTLİ görünmeye devam eder. İptal ise hesabı kapatıp kartın
                    kilidini açar; tekrar denemeyecekse operatörün asıl istediği bu. */}
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
                  disabled={cancelBusy || retryBusy}
                  onClick={cancelRegistration}
                  title="Kaydı iptal et — hesabı kapatır ve cihaz kartının kilidini açar"
                >
                  {cancelBusy ? 'İptal ediliyor…' : 'Kaydı İptal Et'}
                </button>
                <button type="button" className="btn-ghost" onClick={onClose}>Kapat</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {/* Bekleme cezası sürerken İPTAL gizlenir: o an iptale basmak, sırf sayaç
                  aktığı için sağlam bir kaydı çöpe atmak olur. Kullanıcı kararı:
                  "modalda iptal olmasın o kayıt". Kapatmak (arka plana alma) serbest. */}
              {remain > 0 ? (
                <span style={{ fontSize: 12, opacity: 0.75, display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⏳ Bekleme sürüyor — kayıt korunuyor, iptal edilmiyor.
                </span>
              ) : (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
                  disabled={cancelBusy}
                  onClick={cancelRegistration}
                  title="Kaydı iptal et — hesabı başarısız işaretler ve kart kilidini açar"
                >
                  {cancelBusy ? 'İptal ediliyor…' : 'Kaydı İptal Et'}
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={onClose}>Arka planda devam et</button>
            </div>
          )}
        </footer>
      </div>
      {/* Onay modalı — bu ağaca BİR KEZ eklenmeli, yoksa confirm() hiç görünmez.
          zIndex'i yüksek (70) olduğu için bu modalın ÜSTÜNDE çıkar. */}
      {confirmDialog}
    </div>
  );
}
