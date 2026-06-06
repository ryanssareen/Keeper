import Link from "next/link";

/** The Keeper brand mark: an ink tile with the concentric-signal glyph + wordmark. */
export function Logo({ href = "/" }: { href?: string }): React.ReactElement {
  return (
    <Link className="brand" href={href}>
      <span className="logo-tile" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="1.6" fill="#fff" />
          <path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke="#71717a" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="wordmark">Keeper</span>
    </Link>
  );
}
