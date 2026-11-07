import { FileText } from "lucide-react";

/**
 * Decorative preview of a deliverable, shown beside the client login. Purely illustrative
 * (fictitious figures), so it is hidden from assistive technology.
 */
export function ReportPreview() {
  const line = "M0 52 C 22 48, 36 30, 58 34 S 96 54, 120 30 S 160 18, 190 8";
  return (
    <div aria-hidden className="relative mt-10 max-w-md">
      <div className="absolute -left-3 top-3 h-full w-full rotate-[-2.5deg] rounded-2xl border border-white/10 bg-white/5" />
      <div className="relative rounded-2xl border border-white/15 bg-white p-5 text-primary shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-4 w-4 text-accent-foreground" />
            Rapport de gestion · T3 2026
          </div>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Publié</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            ["Marge brute", "25,9 %", "+0,7 pt"],
            ["Charges / CA", "74,1 %", "−0,7 pt"],
            ["Écart budget", "+2,6 %", "à suivre"],
          ].map(([label, value, hint]) => (
            <div key={label} className="rounded-lg bg-muted/70 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-base font-bold leading-tight">{value}</p>
              <p className="text-[10px] text-muted-foreground">{hint}</p>
            </div>
          ))}
        </div>

        <svg viewBox="0 0 190 64" preserveAspectRatio="none" className="mt-4 h-16 w-full" role="presentation">
          <defs>
            <linearGradient id="rp-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#F5B700" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#F5B700" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L190 64 L0 64 Z`} fill="url(#rp-fill)" />
          <path d={line} fill="none" stroke="#1A2B4A" strokeWidth="2" strokeLinecap="round" />
        </svg>

        <div className="mt-3 flex items-end gap-1.5">
          {[38, 52, 44, 63, 58, 72, 66].map((h, i) => (
            <span key={i} className="flex-1 rounded-sm bg-primary/80" style={{ height: `${h * 0.35}px`, opacity: 0.45 + i * 0.08 }} />
          ))}
        </div>
        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Commentaire du consultant : maîtrise des achats à poursuivre, énergie à surveiller.
        </p>
      </div>
    </div>
  );
}
