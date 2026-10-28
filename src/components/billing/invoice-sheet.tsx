import type { Invoice, Prospect } from "@/lib/types";
import { invoiceTotals } from "@/lib/services";
import { formatDate, formatFCFA } from "@/lib/utils/format";

/** Aperçu A4 (bleu nuit et doré). Document de gestion, pas une facture fiscale FNE. */
export function InvoiceSheet({ invoice, client }: { invoice: Invoice; client: Prospect | null }) {
  const { ht, vat, ttc } = invoiceTotals(invoice);
  return (
    <article
      aria-label={`Facture ${invoice.number}`}
      className="mx-auto aspect-[210/297] w-full max-w-[794px] overflow-hidden border border-border bg-white text-[13px] text-slate-800 shadow-sm"
    >
      <header className="flex items-start justify-between bg-primary px-8 py-6 text-white">
        <div>
          <p className="font-heading text-xl font-extrabold">MANGA PERFORMANCE</p>
          <p className="text-xs text-slate-300">Audit · Data · Contrôle de gestion</p>
          <p className="mt-2 text-xs text-slate-300">Abidjan, Côte d&apos;Ivoire</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-accent">FACTURE</p>
          <p className="font-semibold">N° {invoice.number}</p>
          {invoice.fneNumber && <p className="text-xs text-slate-300">N° FNE : {invoice.fneNumber}</p>}
        </div>
      </header>
      <div className="h-1 bg-accent" />

      <div className="grid grid-cols-2 gap-6 px-8 py-6">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Facturé à</p>
          <p className="font-semibold">{client?.companyName ?? "—"}</p>
          <p>{client?.contactName}</p>
          <p>{client?.city}</p>
        </div>
        <div className="text-right">
          <p><span className="text-slate-500">Date d&apos;émission :</span> {formatDate(invoice.issuedAt)}</p>
          <p><span className="text-slate-500">Échéance :</span> {formatDate(invoice.dueAt)}</p>
        </div>
      </div>

      <table className="mx-8 w-[calc(100%-4rem)] text-left">
        <thead>
          <tr className="border-b-2 border-accent text-xs uppercase text-slate-500">
            <th className="py-2 font-semibold">Prestation</th>
            <th className="py-2 text-right font-semibold">Qté</th>
            <th className="py-2 text-right font-semibold">Prix unitaire</th>
            <th className="py-2 text-right font-semibold">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="py-2">{l.label}</td>
              <td className="py-2 text-right">{l.quantity}</td>
              <td className="py-2 text-right">{formatFCFA(l.unitPrice)}</td>
              <td className="py-2 text-right">{formatFCFA(l.quantity * l.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mr-8 mt-6 w-64 space-y-1">
        <div className="flex justify-between"><dt>Total HT</dt><dd>{formatFCFA(ht)}</dd></div>
        <div className="flex justify-between"><dt>TVA ({Math.round(invoice.vatRate * 100)} %)</dt><dd>{formatFCFA(vat)}</dd></div>
        <div className="flex justify-between bg-primary px-2 py-1 font-bold text-white">
          <dt>Total TTC</dt><dd>{formatFCFA(ttc)}</dd>
        </div>
      </dl>

      <footer className="mt-10 px-8 text-xs text-slate-500">
        {/* TODO: mentions légales et coordonnées bancaires à fournir par le client */}
        <p>Coordonnées bancaires : [À fournir par le client]</p>
        <p className="mt-1">
          Document de gestion. La facture fiscale doit être émise via la plateforme FNE de la DGI.
        </p>
      </footer>
    </article>
  );
}
