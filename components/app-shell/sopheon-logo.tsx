// The Sopheon corporate mark shown top-right in Accolade Projects — a teal/blue
// swirl glyph + lowercase wordmark. Decorative (matches the product chrome).
export function SopheonLogo({ className }: { className?: string }) {
  return (
    <span className={`flex select-none items-center gap-1.5 ${className ?? ""}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2.5a9.5 9.5 0 1 0 9.4 11"
          stroke="#1aa7c4"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="3.4" fill="#2f6fb5" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-[#3a4a5a]">sopheon</span>
    </span>
  );
}
