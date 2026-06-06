"use client";

import { useEffect, useState } from "react";

const IMG = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;
const VID = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/**
 * A media thumbnail that opens its image/video in an in-app lightbox popup
 * (overlay) instead of a new browser tab. Non-media URLs fall back to a styled
 * link. Used for draft/ad assets so the founder can preview without leaving
 * the page. Close with ✕, the backdrop, or Escape.
 */
export function MediaThumb({ url, className }: { url: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const isImage = IMG.test(url);
  const isVideo = VID.test(url);

  if (!isImage && !isVideo) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex aspect-square items-center justify-center rounded-card border border-bg-graphite bg-bg-charcoal p-2 text-xs text-zinc-400"
      >
        <span className="break-all">{url}</span>
      </a>
    );
  }

  const thumbCls = className ?? "aspect-square w-full rounded-card object-cover";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full overflow-hidden rounded-card"
        aria-label="Open preview"
      >
        {isImage ? (
          <img src={url} alt="" className={thumbCls} />
        ) : (
          <>
            <video src={url} muted playsInline preload="metadata" className={thumbCls} />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl drop-shadow">
              ▶️
            </span>
          </>
        )}
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
      </button>
      {open && <Lightbox url={url} isVideo={isVideo} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({
  url,
  isVideo,
  onClose,
}: {
  url: string;
  isVideo: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-bg-graphite bg-bg-ink text-lg text-zinc-300 hover:text-white"
      >
        ✕
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] max-w-[92vw] flex-col items-center gap-3"
      >
        {isVideo ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="max-h-[82vh] max-w-[92vw] rounded-card bg-black"
          />
        ) : (
          <img
            src={url}
            alt=""
            className="max-h-[82vh] max-w-[92vw] rounded-card object-contain"
          />
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs uppercase tracking-widest text-zinc-400 hover:text-gold"
        >
          Open original ↗
        </a>
      </div>
    </div>
  );
}
