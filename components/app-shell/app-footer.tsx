// Accolade Projects product footer — thin dark bar with the build/version on the
// left and a "Help us improve" affordance on the right.
export function AppFooter() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between bg-[#1b2733] pl-4 pr-0 text-[11px] text-slate-300">
      <span className="font-mono tracking-tight text-slate-400">
        © 2026 — Wellspring Worldwide Inc · [4.0.6135.0] (HEAD) [6cd2a1456]
      </span>
      <button className="h-full bg-[#10171f] px-4 font-medium text-slate-200 transition-colors hover:bg-black">
        Help us improve
      </button>
    </footer>
  );
}
