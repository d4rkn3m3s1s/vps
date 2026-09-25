// Cihaz listesini bir bileşenin ihtiyaç duyduğu alanlara indirger.
//
// ★2026-09-26 ÖLÇÜM: /applications, /images, /scheduler, /rpa, /synchronizer sayfalarının
// her biri ~445 kB idi; sebep `/devices` yanıtının TAMAMININ (168 cihaz × parmak izi, sunucu,
// metadata ≈ 370 kB) tarayıcıya gömülmesiydi. Bu bileşenler yalnız `id` + `name` (senkron
// ek olarak `status` + `androidVersion`) kullanıyor. TypeScript tipi çalışma anında fazla
// alanları ayıklamaz — bu yardımcı ayıklar.
type Loose = Record<string, unknown>;

export function pickDevices<K extends string>(
  list: ReadonlyArray<unknown> | null | undefined,
  keys: readonly K[]
): Array<Record<K, unknown>> {
  return (list ?? []).map((raw) => {
    const d = (raw ?? {}) as Loose;
    const out = {} as Record<K, unknown>;
    for (const k of keys) out[k] = d[k] ?? null;
    return out;
  });
}
