import { lookup, type LabelDef } from "@/lib/labels";

/** Emoji + color pill driven by the shared label maps in lib/labels.ts.
 *  Usage: <StatusBadge map={LEAD_STATUS} value={lead.status} /> */
export function StatusBadge({
  map,
  value,
  className,
}: {
  map: Record<string, LabelDef>;
  value: string | null | undefined;
  className?: string;
}) {
  const def = lookup(map, value);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium uppercase tracking-widest ${def.cls} ${className ?? ""}`}
    >
      <span aria-hidden>{def.emoji}</span>
      {def.label}
    </span>
  );
}
