"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { Brand } from "@/lib/server/brand";
import { useAppState } from "@/components/providers";
import { PageHeader } from "@/components/shared/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SOCIAL: { key: string; label: string; placeholder: string }[] = [
  { key: "website", label: "Website", placeholder: "https://acme.com" },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/company/acme" },
  { key: "twitter", label: "Twitter / X", placeholder: "https://x.com/acme" },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/acme" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/acme" },
];

export function BrandSettingsClient() {
  // Workspace-level brand (SuprSend `default` tenant) — re-key on workspace, not
  // project. Per-project brand variants are adjusted in the Project view.
  const { workspace } = useAppState();
  return <Body key={workspace} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-background p-1"
          aria-label={`${label} colour picker`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder="#005288" className="font-mono" />
      </div>
    </Field>
  );
}

function Body() {
  const [brand, setBrand] = React.useState<Brand | null>(null);
  // Custom properties edited as an ordered key/value list (Records lose order and
  // make key-renaming awkward). Folded back into the brand on save.
  const [propRows, setPropRows] = React.useState<{ key: string; value: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Snapshot of the last-saved brand so blur saves skip when nothing changed.
  const lastSaved = React.useRef<string>("");

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/brand", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (data.ok) {
          setBrand(data.brand);
          setPropRows(Object.entries(data.brand.properties ?? {}).map(([key, value]) => ({ key, value: value as string })));
          lastSaved.current = JSON.stringify(data.brand);
        } else setError(data.error ?? "Couldn’t load brand settings.");
      } catch {
        if (active) setError("Couldn’t reach SuprSend.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function set<K extends keyof Brand>(key: K, value: Brand[K]) {
    setBrand((b) => (b ? { ...b, [key]: value } : b));
  }
  function setSocial(key: string, value: string) {
    setBrand((b) => (b ? { ...b, socialLinks: { ...b.socialLinks, [key]: value } } : b));
  }

  // Auto-save on blur (when you finish editing a field) — no Save button. Skips
  // when nothing changed since the last save. Custom properties are folded in from
  // propRows (drops blank-key rows).
  async function save(rowsOverride?: { key: string; value: string }[]) {
    if (!brand) return;
    const rows = rowsOverride ?? propRows;
    const properties: Record<string, string> = {};
    for (const r of rows) if (r.key.trim()) properties[r.key.trim()] = r.value;
    const payload = { ...brand, properties };
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSaved.current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
      });
      const data = await res.json();
      if (data.ok) lastSaved.current = snapshot;
      else toast.error("Couldn’t save", { description: data.error });
    } catch {
      toast.error("Couldn’t reach SuprSend.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Brand"
        description="The workspace default brand — logo, colours and links used by emails and the inbox. Changes save automatically."
        actions={brand ? <span className="text-xs text-muted-foreground">{saving ? "Saving…" : "All changes saved"}</span> : undefined}
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {!brand ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Editor */}
          <div className="space-y-6">
            <section className="space-y-3 rounded-lg border border-border p-4">
              <h2 className="text-sm font-semibold">Identity</h2>
              <Field label="Brand name">
                <Input value={brand.tenantName} onChange={(e) => set("tenantName", e.target.value)} onBlur={() => save()} placeholder="Acme Inc." />
              </Field>
              <Field label="Logo URL">
                <Input value={brand.logo} onChange={(e) => set("logo", e.target.value)} onBlur={() => save()} placeholder="https://…/logo.png" />
              </Field>
            </section>

            <section className="space-y-3 rounded-lg border border-border p-4">
              <h2 className="text-sm font-semibold">Colours</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <ColorField label="Primary" value={brand.primaryColor} onChange={(v) => set("primaryColor", v)} onBlur={() => save()} />
                <ColorField label="Secondary" value={brand.secondaryColor} onChange={(v) => set("secondaryColor", v)} onBlur={() => save()} />
                <ColorField label="Tertiary" value={brand.tertiaryColor} onChange={(v) => set("tertiaryColor", v)} onBlur={() => save()} />
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-border p-4">
              <h2 className="text-sm font-semibold">Links</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {SOCIAL.map((s) => (
                  <Field key={s.key} label={s.label}>
                    <Input
                      value={brand.socialLinks[s.key] ?? ""}
                      onChange={(e) => setSocial(s.key, e.target.value)}
                      onBlur={() => save()}
                      placeholder={s.placeholder}
                    />
                  </Field>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Custom properties</h2>
                <button
                  type="button"
                  onClick={() => setPropRows((rows) => [...rows, { key: "", value: "" }])}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                >
                  <Plus className="size-3.5" /> Add
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Extra key/value fields on the project. Usable in templates as {`{{$brand.<key>}}`}.</p>
              {propRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom properties yet.</p>
              ) : (
                <div className="space-y-2">
                  {propRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={row.key}
                        onChange={(e) => setPropRows((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                        onBlur={() => save()}
                        placeholder="key"
                        className="font-mono"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => setPropRows((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                        onBlur={() => save()}
                        placeholder="value"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = propRows.filter((_, j) => j !== i);
                          setPropRows(next);
                          void save(next);
                        }}
                        className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive"
                        aria-label="Remove property"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Live preview */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Preview</h2>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border p-4">
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo} alt={brand.tenantName} className="h-7 max-w-[140px] object-contain" />
                ) : (
                  <span className="text-sm font-semibold">{brand.tenantName || "Your brand"}</span>
                )}
              </div>
              <div className="space-y-3 p-4">
                <p className="text-sm text-muted-foreground">
                  Sample email from <strong className="text-foreground">{brand.tenantName || "—"}</strong>.
                </p>
                <button
                  type="button"
                  className="rounded-md px-3.5 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: brand.primaryColor || "#111" }}
                >
                  Branded button
                </button>
                <div className="flex gap-2 pt-1">
                  {[brand.primaryColor, brand.secondaryColor, brand.tertiaryColor].map((c, i) => (
                    <span key={i} className="size-6 rounded border border-border" style={{ backgroundColor: c || "transparent" }} title={c} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
