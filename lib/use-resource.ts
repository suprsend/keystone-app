"use client";

import * as React from "react";

const NETWORK_ERROR = "Couldn’t reach SuprSend.";

/** Our standard JSON response shape: `{ ok, error?, …payload }`. */
type Envelope = { ok?: boolean; error?: string } & Record<string, unknown>;

export type Resource<T> = {
  /** The selected value once loaded; null while loading or on error. */
  data: T | null;
  /** A user-facing error string, or null. */
  error: string | null;
  /** True until the first response (success or failure) resolves. */
  loading: boolean;
  /** Re-run the fetch (e.g. a Refresh button or after a write). */
  reload: () => Promise<void>;
  /** Set the value directly — for optimistic updates before/around a write. */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
};

/**
 * Client GET for our `{ ok, error, … }` JSON envelope. Collapses the
 * mount-guard → no-store fetch → `!ok`→error → catch→network-error → cleanup
 * scaffold that was copy-pasted across every data client.
 *
 * `select` maps the parsed envelope to the value you want to store (e.g.
 * `(d) => d.workflows as WF[]`). Pass `url = null` to skip fetching (sentinel
 * actor, not-ready deps) — `data` stays null and `loading` is false.
 *
 * Guard skeletons on `loading`, not on `data === null`: on error `data` is
 * null but `loading` is false, so the error banner shows instead of a
 * perpetual skeleton.
 *
 * `deps` re-fetches when a value other than the URL changes (e.g. the active
 * workspace, which the server reads from the cookie so the URL stays constant).
 * Keep `deps` to primitives — they're serialized into the refetch key.
 */
export function useResource<T>(
  url: string | null,
  select: (data: Envelope) => T,
  loadingError = "Couldn’t load.",
  deps: React.DependencyList = [],
): Resource<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(url !== null);

  // Keep the latest select/message reachable from `run` without making them
  // dependencies — callers pass inline closures that change identity every
  // render. Refs are updated in a commit-time effect (not during render).
  const selectRef = React.useRef(select);
  const errorRef = React.useRef(loadingError);
  React.useEffect(() => {
    selectRef.current = select;
    errorRef.current = loadingError;
  });

  const activeRef = React.useRef(true);

  const run = React.useCallback(async () => {
    if (url === null) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as Envelope;
      if (!activeRef.current) return;
      if (!json.ok) {
        setError(json.error ?? errorRef.current);
        setData(null);
      } else {
        setError(null);
        setData(selectRef.current(json));
      }
    } catch {
      if (activeRef.current) {
        setError(NETWORK_ERROR);
        setData(null);
      }
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [url]);

  // Refetch on mount, when the URL changes, or when any `deps` value changes.
  const depKey = `${url}|${JSON.stringify(deps)}`;
  React.useEffect(() => {
    activeRef.current = true;
    // Re-show the skeleton when the fetch key changes (URL or a dep like the
    // active workspace) — intentional sync of loading to the new fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(url !== null);
    void run();
    return () => {
      activeRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, depKey]);

  const reload = React.useCallback(async () => {
    activeRef.current = true;
    await run();
  }, [run]);

  return { data, error, loading, reload, setData };
}
