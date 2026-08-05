import { z } from 'zod';

// Ortak ülke-kodu şeması (ISO-3166-1 alpha-2).
//
// ★2026-08-05 NEDEN VAR: her modül `z.string().length(2)` kullanıyordu — bu SADECE
// uzunluğa bakar. Telefon kodu "90" da iki karakter olduğu için doğrulamadan
// GEÇİYORDU. Canlıda bir proxy kaydı `countryCode="90"` ile oluştu ("Provision 90"),
// thordata login'ine `country-90` olarak gömüldü; böyle bir ülke havuzu olmadığı için
// cihaz (mi135 / "deneme") hiç çıkış alamadı. Daha kötüsü: health-watch ülkeyi
// çözemediği için ("? mi135: çıkış-IP alınamadı, ülke bilinmiyor → düzeltilemiyor")
// kurtarma da denemedi — cihaz SESSİZCE ölü kaldı, saatlerce.
//
// Kural: iki HARF zorunlu, büyük harfe normalize edilir. Böylece "tr" de kabul edilir
// ama "90" reddedilir ve hata mesajı operatöre ne yapması gerektiğini söyler.
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'Ülke kodu ISO-3166-1 alpha-2 olmalı (örn. TR, GB) — telefon kodu değil')
  .transform((s) => s.toUpperCase());
