// Accolade product Dashboard — a hardcoded portfolio overview for Wellspring's
// stage-gate New Product Development tool (the first thing shown when the demo
// opens). Static by design: this is product chrome to make the notification
// surfaces feel native inside Accolade.

const METRICS: { label: string; value: string; sub: string; tone?: "warn" | "muted" }[] = [
  { label: "Active Projects", value: "12", sub: "Across all gates" },
  { label: "Gate Reviews Due", value: "4", sub: "Next 14 days", tone: "warn" },
  { label: "Ideas in Pipeline", value: "27", sub: "Awaiting screening" },
  { label: "Projects On Hold", value: "3", sub: "Paused this quarter" },
  { label: "Avg. Days in Stage", value: "18", sub: "All active projects" },
  { label: "Overdue Tasks", value: "5", sub: "All projects", tone: "warn" },
];

const STAGES: { name: string; count: number }[] = [
  { name: "Discovery", count: 27 },
  { name: "Scoping", count: 8 },
  { name: "Business Case", count: 6 },
  { name: "Development", count: 9 },
  { name: "Testing", count: 4 },
  { name: "Launch", count: 3 },
];

function Funnel() {
  const max = Math.max(...STAGES.map((s) => s.count));
  return (
    <div className="mt-5 flex flex-col gap-3">
      {STAGES.map((s) => (
        <div key={s.name} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-muted-foreground">{s.name}</span>
          <div className="h-5 flex-1 rounded bg-muted">
            <div
              className="h-5 rounded bg-primary"
              style={{ width: `${Math.round((s.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums">{s.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Dummy screen — sample portfolio data for product fidelity. Not functional.
      </div>
      <div className="flex items-center gap-1 border-b border-border text-sm">
        {["Portfolio Dashboard", "Stage-Gate View", "My Projects"].map((t, i) => (
          <span
            key={t}
            className={
              "-mb-px border-b-2 px-3 py-2 font-medium " +
              (i === 0 ? "border-primary text-foreground" : "border-transparent text-muted-foreground")
            }
          >
            {t}
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border p-5 lg:row-span-2">
          <p className="text-sm font-semibold">Projects by Stage</p>
          <p className="text-xs text-muted-foreground">Across the portfolio</p>
          <Funnel />
        </div>

        {METRICS.map((m) => (
          <div key={m.label} className="flex flex-col justify-between rounded-xl border border-border p-5">
            <div>
              <p className="text-sm font-semibold">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.sub}</p>
            </div>
            <p
              className={
                "mt-6 text-4xl font-bold tabular-nums " +
                (m.tone === "warn" ? "text-orange-500" : "text-foreground")
              }
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
