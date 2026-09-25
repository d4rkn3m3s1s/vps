// İş listesini tarayıcıya göndermeden önce AĞIR ekran kareleri ayıklanır.
//
// ★2026-09-26 ÖLÇÜM: `/jobs?limit=50` yanıtı 2.27 MB, bunun %98'i kayıt işlerinin
// `result.shots` dizisi (iş başına 4-6 tam boy PNG, base64). İş listesi sayfası bu
// kareleri HİÇ göstermiyor (yalnız EMULATOR_SCREENSHOT'ın `screenshotBase64`'ünü
// gösteriyor). Üstelik JobsView her job.created/job.updated olayında listeyi yeniden
// çekiyordu → sayfa açıkken birkaç saniyede bir megabaytlar iniyordu.
// Kareler hesabın kendi ekranında (/accounts/batch/accounts/:id/shots) görülmeye devam eder.
export function slimJobs<T extends { result?: unknown }>(jobs: T[] | null | undefined): T[] {
  return (jobs ?? []).map((j) => {
    const r = j.result as Record<string, unknown> | null | undefined;
    if (!r || typeof r !== 'object' || !Array.isArray(r.shots)) return j;
    const { shots, ...rest } = r as Record<string, unknown> & { shots: Array<{ label?: unknown } | null> };
    return {
      ...j,
      result: {
        ...rest,
        shotsCount: shots.length,
        shotLabels: shots.map((s) => (s && typeof s.label === 'string' ? s.label : null)).filter(Boolean)
      }
    };
  });
}
