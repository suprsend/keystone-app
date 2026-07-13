import * as React from "react";

// Microsoft Teams mark (purple, with the white "T" board + person bubble),
// transparent background. Sized via className (defaults to 1em). Replace with the
// brand-supplied asset if a more exact mark is provided.
export function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      {/* person bubble (top-right) */}
      <circle cx="37.5" cy="12" r="6" fill="#7B83EB" />
      <path
        d="M44 22.5c0-1.7-1.4-3-3-3H34c-1.7 0-3 1.3-3 3V31a6.5 6.5 0 0 0 13 0V22.5z"
        fill="#5059C9"
      />
      {/* main "T" board */}
      <rect x="4" y="11.5" width="26" height="25" rx="3.5" fill="#4B53BC" />
      <path
        d="M11 18.5h12v3.2h-4.4V30h-3.2v-8.3H11v-3.2z"
        fill="#ffffff"
      />
    </svg>
  );
}
