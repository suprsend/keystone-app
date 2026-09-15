// Mapping between the UI Conditions model (Condition, in conditions-cell.tsx) and
// SuprSend's condition_attributes. The UI manages only integer-metric attributes
// (e.g. "cost"); other attributes — notably "role" (the Recipients targeting) — are
// PRESERVED untouched. Neutral module; only a TYPE is imported from the client cell.
import type { Condition } from "@/components/admin/conditions-cell";

export interface SsConditionAttr {
  key: string;
  label?: string;
  value_type: string; // integer | string | string_choice | list_choice | string_dynamic | list_dynamic
  choices?: { label: string; value: string }[];
  default_value?: unknown;
  default_value_expr?: string;
  edit_policy?: "locked" | "editable";
}

// Keys the Conditions column owns. "role" (Recipients) and anything else are left
// as-is on save, so wiring conditions never clobbers recipient targeting.
const MANAGED_KEYS = new Set(["cost"]);

export function ssAttrsToConditions(attrs?: SsConditionAttr[] | null): Condition[] {
  return (attrs ?? [])
    .filter((a) => MANAGED_KEYS.has(a.key) && a.value_type === "integer")
    .map((a) => ({
      key: a.key,
      label: a.label ?? a.key,
      value: Number(a.default_value ?? 0),
      editable: a.edit_policy === "editable",
    }));
}

// Merge the UI's conditions back into the live attribute list: keep every attribute
// the UI doesn't manage (role, etc.), replace the managed ones (cost).
export function mergeConditionsIntoAttrs(
  existing: SsConditionAttr[] | null | undefined,
  conditions: Condition[],
): SsConditionAttr[] {
  const preserved = (existing ?? []).filter((a) => !MANAGED_KEYS.has(a.key));
  const managed: SsConditionAttr[] = conditions.map((c) => ({
    key: c.key,
    label: c.label,
    value_type: "integer",
    default_value: c.value,
    edit_policy: c.editable ? "editable" : "locked",
  }));
  return [...preserved, ...managed];
}

// Merge recipient roles into the live attribute list as the `role` list_choice
// attribute's default_value — the WORKSPACE default the workflow condition
// ($category.properties.role) falls back to when a project has no tenant override.
// Preserves the existing role declaration (choices/edit_policy) and every other
// attribute (cost/include/except). A category with no role attribute yet gets the
// chosen roles as its choices. Empty roles → default_value:null (SuprSend rejects
// []), matching the include/except convention.
export function mergeRoleIntoAttrs(
  existing: SsConditionAttr[] | null | undefined,
  roles: string[],
): SsConditionAttr[] {
  const attrs = existing ?? [];
  const preserved = attrs.filter((a) => a.key !== "role");
  const current = attrs.find((a) => a.key === "role");
  const role: SsConditionAttr = {
    ...current,
    key: "role",
    label: current?.label ?? "Role",
    value_type: "list_choice",
    edit_policy: current?.edit_policy ?? "editable",
    choices: current?.choices ?? roles.map((r) => ({ label: r, value: r })),
    default_value: roles.length ? roles : null,
  };
  return [...preserved, role];
}
