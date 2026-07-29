// Telefon numarası + OTP girdisinin HOŞGÖRÜLÜ normalizasyonu.
//
// ★2026-07-29 — NEDEN VAR: operatör numarayı doğal biçimde yazıyor
// ("+90 555 111 22 33", "0090-555-111-2233", "(555) 111 22 33") ve OTP'yi de
// SMS'ten kopyalarken boşlukla alabiliyor ("123 456"). Bu girdiler daha doğrulama
// katmanında (zod) reddediliyor ya da daha kötüsü YANLIŞ yorumlanıyordu:
// Telegram'daki `/testmesaj` regex'i boşluklu numarayı yakalayınca mesaj metnini de
// numaranın içine çekiyor ve operatörün yazdığı mesaj yerine varsayılan test metnini
// GERÇEK bir kişiye gönderiyordu.
//
// Tasarım kuralı: normalizasyon YALNIZCA biçimseldir — rakamları asla değiştirmez,
// eklemez, ülke kodu tahmin etmez. Sadece insanların yazarken kullandığı ayırıcıları
// (boşluk, tire, parantez, nokta) ve uluslararası "00" önekini temizler. Belirsiz bir
// girdi geldiğinde sessizce "düzeltmek" yerine null döndürüp çağıranın açık bir hata
// vermesini tercih ederiz — sessiz yanlış-numara, hata mesajından çok daha kötüdür.

/** İnsan biçimli telefon girdisini yalnız-rakam hâline getirir. Geçersizse null. */
export function normalizePhoneInput(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Yalnızca telefon biçiminde kullanılan karakterlere izin ver. Harf içeren bir
  // girdi (ör. yanlışlıkla yapıştırılmış bir isim) burada elenir — tahmin etmeyiz.
  if (!/^[\d\s+()\-.]+$/.test(s)) return null;
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;
  // Uluslararası "00" öneki → at (0090555… → 90555…). Tek başına baştaki 0'a DOKUNMA:
  // yerel biçimde yazılmış olabilir ve ülke kodunu uydurmak yanlış numara demektir.
  digits = digits.replace(/^00(?=\d)/, '');
  // Makul aralık: ülke kodu dahil en az 7, en fazla 15 hane (E.164 üst sınırı).
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/** SMS kodundaki boşluk/tire gibi ayırıcıları temizler. Geçersizse null. */
export function normalizeOtpInput(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // OTP yalnızca rakam + ayırıcı olabilir ("123 456", "123-456").
  if (!/^[\d\s\-.]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  // WhatsApp 6 hane kullanır; diğer akışlar için 4-8 aralığı serbest.
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

/**
 * Bir metnin BAŞINDAKİ telefon numarasını (boşluklu olabilir) ayırıp kalanı döndürür.
 *
 * ★Telegram `/testmesaj 90 555 111 22 33 Merhaba` sorunu için: açgözlü bir
 * `[\d\s]+` deseni mesajın kendisini de numaraya katıyordu. Buradaki yaklaşım
 * rakamları soldan toplayıp E.164 üst sınırında (15 hane) DURMAK ve ilk
 * rakam-olmayan/ayırıcı-olmayan karakterden itibaren kalanı mesaj saymak.
 * Böylece "90 555 111 22 33 Merhaba" → { phone: "905551112233", rest: "Merhaba" }.
 */
export function splitLeadingPhone(text: string): { phone: string | null; rest: string } {
  const s = String(text ?? '').trim();
  let i = 0;
  let digits = '';
  // Numaranın bittiği en son güvenli konum (ayırıcı öncesi). Mesaja taşmayı önler.
  let lastEnd = 0;
  // Baştaki '+' işaretini atla.
  if (s[i] === '+') i++;
  while (i < s.length && digits.length < 15) {
    const ch = s[i]!;
    if (/\d/.test(ch)) { digits += ch; i++; lastEnd = i; continue; }
    if (/[\s\-.()]/.test(ch)) {
      // ★Ayırıcıdan sonra devam etmek YALNIZCA numara henüz TAMAMLANMAMIŞSA güvenli.
      // Eşik, tam bir uluslararası numaranın uzunluğu (12 hane: 90 + 10 haneli abone).
      // Bu eşiğe ulaşıldıysa dururuz — aksi halde rakamla BAŞLAYAN bir mesaj
      // ("90 555 111 22 33 2 adet lazım" → "…2") numaraya karışır ve mesaj YANLIŞ
      // NUMARAYA gider. Eşiğin altındayken devam ederiz ki boşlukla yazılmış numara
      // ("90 555 111 22 33") eksik kesilmesin.
      if (digits.length >= 12) break;
      const nextDigit = /^[\s\-.()]*\d/.test(s.slice(i));
      if (nextDigit) { i++; continue; }
      break;
    }
    break; // harf vb. → numara bitti
  }
  const normalized = normalizePhoneInput(digits);
  if (!normalized) return { phone: null, rest: s };
  return { phone: normalized, rest: s.slice(lastEnd).trim() };
}
