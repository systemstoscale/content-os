import * as React from "react";
import Link from "next/link";
import { Breadcrumb, type Crumb } from "./breadcrumb";

const MAX = {
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

/** Consistent page shell: centered max-width, phone-safe padding, optional
 *  large-title header with a breadcrumb (or back link) and right-aligned
 *  actions. Replaces the ad-hoc `<main className="mx-auto max-w-… px-6 py-10">`
 *  + hand-rolled "← Dashboard" link repeated across every page. */
export function PageLayout({
  title,
  subtitle,
  crumbs,
  back,
  actions,
  maxWidth = "6xl",
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  crumbs?: Crumb[];
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  maxWidth?: keyof typeof MAX;
  children: React.ReactNode;
}) {
  return (
    <main className={`mx-auto w-full ${MAX[maxWidth]} px-5 py-8 pt-[calc(env(safe-area-inset-top)+1.5rem)]`}>
      {crumbs ? (
        <Breadcrumb items={crumbs} />
      ) : back ? (
        <Link href={back.href} className="text-2xs uppercase tracking-widest text-zinc-500 transition hover:text-gold">
          ← {back.label}
        </Link>
      ) : null}

      {(title || actions) && (
        <header className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h1 className="font-display text-2xl sm:text-3xl">{title}</h1>}
            {subtitle && <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}

      {children}
    </main>
  );
}
