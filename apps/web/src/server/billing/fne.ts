/**
 * FNE (Facture Normalisée Électronique, DGI).
 *
 * No integration with the DGI API in this phase: there is no official specification yet
 * (spec, 6.4 and 14). The interface exists so a real provider can be plugged in later;
 * `ManualFneProvider` only keeps the number the consultant types in after issuing the
 * normalised invoice on the DGI platform.
 */
export interface FneInvoice {
  id: string;
  number: string;
  fneNumber: string | null;
}

export type FneStatus = "PENDING_MANUAL" | "RECORDED";

export interface FneProvider {
  /** Asks the provider to issue the normalised invoice. */
  submitInvoice(invoice: FneInvoice): Promise<{ status: FneStatus; fneNumber: string | null }>;
  getStatus(invoice: FneInvoice): Promise<{ status: FneStatus; fneNumber: string | null }>;
}

export class ManualFneProvider implements FneProvider {
  async submitInvoice(invoice: FneInvoice) {
    // Nothing is sent anywhere: the consultant issues the FNE on the DGI platform by hand.
    return this.getStatus(invoice);
  }

  async getStatus(invoice: FneInvoice) {
    return invoice.fneNumber
      ? { status: "RECORDED" as const, fneNumber: invoice.fneNumber }
      : { status: "PENDING_MANUAL" as const, fneNumber: null };
  }
}
