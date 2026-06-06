"use client";

import * as React from "react";

/** Bottom sheet on phones (slides up, grab handle, safe-area), centered modal
 *  on desktop. Native-app feel for confirmations + pickers. Closes on backdrop
 *  tap or Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full animate-slide-up rounded-t-2xl border border-bg-graphite bg-bg-deep p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:max-w-md sm:rounded-card sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-bg-graphite sm:hidden" aria-hidden />
        {title && <h3 className="mb-3 font-display text-base">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
