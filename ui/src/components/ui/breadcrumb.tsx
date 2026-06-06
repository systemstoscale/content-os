import * as React from "react";
import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

/** Tappable hierarchy trail for deep trees (paid, prospecting, partnerships).
 *  The last crumb is the current page (not a link). */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-2xs uppercase tracking-widest text-zinc-500">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1">
            {c.href && !last ? (
              <Link href={c.href} className="transition hover:text-gold">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "text-zinc-300" : ""}>{c.label}</span>
            )}
            {!last && <span className="text-zinc-700" aria-hidden>/</span>}
          </span>
        );
      })}
    </nav>
  );
}
