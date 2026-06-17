import Link from 'next/link';
import { ArrowUpRight, Crown } from 'lucide-react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260606_154941_df1a96e1-a06f-450c-bd02-d863414cc1a0.mp4';

// Contained welcome banner for the dashboard overview. Same video + PODIUM/Inter
// styling as the landing/login, but lives in the page flow (not fullscreen) so
// the working panels below stay usable. Live fleet numbers come from props.
export function DashboardHero({
  total,
  online,
  jobs
}: {
  total: number;
  online: number;
  jobs: number;
}) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/10 font-inter">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        src={VIDEO_URL}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/65 to-black/30" />

      <div className="relative z-10 flex flex-col gap-6 px-6 py-8 sm:px-10 sm:py-12 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-4 flex items-center gap-2 animate-fade-up">
            <Crown className="h-4 w-4 text-white/70" />
            <span className="font-inter text-[10px] uppercase tracking-[0.3em] text-white/70 sm:text-xs">
              VPS Fleet Control Center
            </span>
          </div>
          <h1 className="font-podium uppercase leading-[0.95] tracking-tight text-white animate-fade-up-delay-1">
            <span className="block text-[clamp(2rem,5vw,3.6rem)]">Command</span>
            <span className="block text-[clamp(2rem,5vw,3.6rem)]">Your Fleet.</span>
          </h1>

          <div className="mt-6 flex flex-wrap gap-6 animate-fade-up-delay-2 sm:gap-10">
            <div>
              <div className="font-inter text-2xl font-bold tracking-tight text-white sm:text-3xl">{total}</div>
              <div className="mt-1 text-[9px] uppercase tracking-widest text-white/50 sm:text-[10px]">Cloud Phones</div>
            </div>
            <div>
              <div className="font-inter text-2xl font-bold tracking-tight text-white sm:text-3xl">{online}</div>
              <div className="mt-1 text-[9px] uppercase tracking-widest text-white/50 sm:text-[10px]">Online Now</div>
            </div>
            <div>
              <div className="font-inter text-2xl font-bold tracking-tight text-white sm:text-3xl">{jobs}</div>
              <div className="mt-1 text-[9px] uppercase tracking-widest text-white/50 sm:text-[10px]">Total Jobs</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 animate-fade-up-delay-3">
          <Link
            href="/profiles"
            className="group flex items-center gap-2 bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-black transition-all hover:bg-white/90"
          >
            New Phone
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/welcome"
            className="flex items-center gap-2 border border-white/30 px-5 py-3 text-[11px] uppercase tracking-widest text-white transition-all hover:border-white/60 hover:bg-white/10"
          >
            View Platform
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
