// Keystone product footer — thin bar with the build/version on the left and a
// "Help us improve" affordance on the right.
export function AppFooter() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-muted pl-4 pr-0 text-[11px] text-muted-foreground">
      <span className="font-mono tracking-tight text-muted-foreground">
        © 2026 — Keystone · [4.0.6135.0] (HEAD) [6cd2a1456]
      </span>
      <button className="h-full bg-secondary px-4 font-medium text-secondary-foreground transition-colors hover:bg-accent">
        Help us improve
      </button>
    </footer>
  );
}
