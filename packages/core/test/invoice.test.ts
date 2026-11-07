import { describe, expect, it } from "vitest";
import {
  InvoiceCalculationError,
  MAX_AMOUNT,
  MAX_REMINDERS,
  amountDue,
  computeInvoiceStatus,
  computeInvoiceTotals,
  divRound,
  formatFcfa,
  formatInvoiceNumber,
  invoiceYear,
  isReminderDue,
  lineTotal,
  negateLines,
  parseInvoiceNumber,
} from "../src/invoice";

describe("divRound", () => {
  it.each([
    [0, 100, 0],
    [49, 100, 0],
    [50, 100, 1], // half rounds away from zero
    [51, 100, 1],
    [149, 100, 1],
    [150, 100, 2],
    [-49, 100, 0],
    [-50, 100, -1],
    [-150, 100, -2],
    [7, 2, 4],
    [-7, 2, -4],
    [1, 3, 0],
    [2, 3, 1],
  ])("divRound(%i, %i) = %i", (n, d, expected) => {
    expect(divRound(n, d)).toBe(expected);
  });

  it("is exactly antisymmetric", () => {
    // `+ 0` normalises the -0 that negating 0 would produce.
    for (let n = 0; n <= 1000; n += 7) expect(divRound(-n, 100)).toBe(-divRound(n, 100) + 0);
  });

  it("stays exact on large integers (no float drift)", () => {
    // 1_999_999_999 × 1800 = 3_599_999_998_200: far beyond 2^31, well within 2^53.
    // Divided by 10 000 that is 359 999 999.82, rounded to 360 000 000.
    expect(divRound(1_999_999_999 * 1800, 10_000)).toBe(360_000_000);
  });

  it("rejects non-integers and bad denominators", () => {
    expect(() => divRound(1.5, 2)).toThrow(RangeError);
    expect(() => divRound(1, 0)).toThrow(RangeError);
    expect(() => divRound(1, -2)).toThrow(RangeError);
  });
});

describe("lineTotal", () => {
  it("multiplies quantity (in hundredths) by the unit price", () => {
    expect(lineTotal(100, 250_000)).toBe(250_000); // 1 × 250 000
    expect(lineTotal(150, 250_000)).toBe(375_000); // 1.5 × 250 000
    expect(lineTotal(250, 100_000)).toBe(250_000); // 2.5 days
  });
  it("rounds to the unit", () => {
    expect(lineTotal(33, 1000)).toBe(330); // 0.33 × 1000
    expect(lineTotal(1, 150)).toBe(2); // 0.01 × 150 = 1.5 -> 2
    expect(lineTotal(1, 149)).toBe(1); // 1.49 -> 1
    expect(lineTotal(1, 50)).toBe(1); // 0.5 -> 1
    expect(lineTotal(1, 49)).toBe(0);
  });
  it("handles zero and negative values (credit notes)", () => {
    expect(lineTotal(0, 5000)).toBe(0);
    expect(lineTotal(100, -250_000)).toBe(-250_000);
    expect(lineTotal(1, -150)).toBe(-2);
  });
});

describe("computeInvoiceTotals", () => {
  const line = (quantity: number, unitPrice: number, label = "Prestation") => ({ label, quantity, unitPrice });

  it("computes HT, VAT at 18 % and TTC", () => {
    const totals = computeInvoiceTotals([line(100, 500_000), line(200, 150_000)], 1800);
    expect(totals.totalHt).toBe(800_000);
    expect(totals.totalVat).toBe(144_000);
    expect(totals.totalTtc).toBe(944_000);
    expect(totals.lines.map((l) => [l.position, l.total])).toEqual([[1, 500_000], [2, 300_000]]);
  });

  it("rounds VAT once on the invoice total, not per line", () => {
    // Three lines of 1 FCFA: per-line VAT would be 3 × round(0.18) = 0; on the total it is round(0.54) = 1.
    const totals = computeInvoiceTotals([line(100, 1), line(100, 1), line(100, 1)], 1800);
    expect(totals.totalHt).toBe(3);
    expect(totals.totalVat).toBe(1);
    expect(totals.totalTtc).toBe(4);
  });

  it.each([
    [1, 0], // 0.18
    [2, 0], // 0.36
    [3, 1], // 0.54
    [5, 1], // 0.90
    [250, 45], // exact
    [1111, 200], // 199.98
    [2778, 500], // 500.04
  ])("VAT of %i FCFA HT at 18 %% is %i", (ht, vat) => {
    expect(computeInvoiceTotals([line(100, ht)], 1800).totalVat).toBe(vat);
  });

  it("supports other rates, including 0 %", () => {
    expect(computeInvoiceTotals([line(100, 1000)], 0)).toMatchObject({ totalVat: 0, totalTtc: 1000 });
    expect(computeInvoiceTotals([line(100, 1000)], 1000)).toMatchObject({ totalVat: 100, totalTtc: 1100 });
    expect(computeInvoiceTotals([line(100, 1000)], 10_000)).toMatchObject({ totalVat: 1000, totalTtc: 2000 });
  });

  it("returns zeros for an empty invoice", () => {
    expect(computeInvoiceTotals([], 1800)).toEqual({ lines: [], totalHt: 0, totalVat: 0, totalTtc: 0 });
  });

  it("keeps the TTC equal to HT + VAT, always", () => {
    for (const price of [1, 7, 99, 1234, 98_765, 1_000_001]) {
      for (const qty of [1, 33, 100, 150, 999]) {
        const t = computeInvoiceTotals([line(qty, price), line(100, price + 3)], 1800);
        expect(t.totalTtc).toBe(t.totalHt + t.totalVat);
        expect(t.totalHt).toBe(t.lines.reduce((s, l) => s + l.total, 0));
      }
    }
  });

  it("rejects invalid rates, fractions and oversized amounts", () => {
    expect(() => computeInvoiceTotals([line(100, 1)], -1)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(100, 1)], 10_001)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(100, 1)], 18.5)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(1.5, 100)], 1800)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(100, 0.5)], 1800)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(100, MAX_AMOUNT)], 1800)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(MAX_AMOUNT + 1, 1)], 1800)).toThrow(InvoiceCalculationError);
    expect(() => computeInvoiceTotals([line(100, MAX_AMOUNT + 1)], 1800)).toThrow(InvoiceCalculationError);
  });

  it("accepts a total right at the database limit", () => {
    expect(computeInvoiceTotals([line(100, 1_694_915_254)], 1800).totalTtc).toBeLessThanOrEqual(MAX_AMOUNT);
  });
});

describe("negateLines", () => {
  it("produces an exact opposite invoice, for any rounding", () => {
    const lines = [
      { label: "Audit", quantity: 33, unitPrice: 1555 },
      { label: "Formation", quantity: 150, unitPrice: 250_001 },
      { label: "Frais", quantity: 1, unitPrice: 150 },
    ];
    const original = computeInvoiceTotals(lines, 1800);
    const credit = computeInvoiceTotals(negateLines(lines), 1800);
    expect(credit.totalHt).toBe(-original.totalHt);
    expect(credit.totalVat).toBe(-original.totalVat);
    expect(credit.totalTtc).toBe(-original.totalTtc);
    expect(credit.lines.map((l) => l.label)).toEqual(lines.map((l) => l.label));
  });
});

describe("computeInvoiceStatus", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const future = new Date("2026-12-06T12:00:00Z");
  const past = new Date("2026-10-06T12:00:00Z");
  const invoice = (over: Partial<Parameters<typeof computeInvoiceStatus>[0]>) => ({
    status: "EMISE" as const,
    totalTtc: 1000,
    amountPaid: 0,
    dueAt: future,
    ...over,
  });

  it("is EMISE when nothing is paid and not yet due", () => {
    expect(computeInvoiceStatus(invoice({}), now)).toBe("EMISE");
  });
  it("is PARTIELLEMENT_PAYEE when partly paid and not yet due", () => {
    expect(computeInvoiceStatus(invoice({ amountPaid: 400 }), now)).toBe("PARTIELLEMENT_PAYEE");
  });
  it("is PAYEE once the amount paid reaches the total, even overpaid or overdue", () => {
    expect(computeInvoiceStatus(invoice({ amountPaid: 1000 }), now)).toBe("PAYEE");
    expect(computeInvoiceStatus(invoice({ amountPaid: 1200, dueAt: past }), now)).toBe("PAYEE");
  });
  it("is EN_RETARD when unpaid or partly paid after the due date", () => {
    expect(computeInvoiceStatus(invoice({ dueAt: past }), now)).toBe("EN_RETARD");
    expect(computeInvoiceStatus(invoice({ dueAt: past, amountPaid: 999 }), now)).toBe("EN_RETARD");
  });
  it("is overdue strictly after the due date", () => {
    expect(computeInvoiceStatus(invoice({ dueAt: now }), now)).toBe("EMISE");
  });
  it("leaves drafts and cancelled invoices alone, and tolerates a missing due date", () => {
    expect(computeInvoiceStatus(invoice({ status: "BROUILLON", dueAt: past }), now)).toBe("BROUILLON");
    expect(computeInvoiceStatus(invoice({ status: "ANNULEE", amountPaid: 1000 }), now)).toBe("ANNULEE");
    expect(computeInvoiceStatus(invoice({ dueAt: null }), now)).toBe("EMISE");
  });
  it("computes what is still due", () => {
    expect(amountDue({ totalTtc: 1000, amountPaid: 400 })).toBe(600);
    expect(amountDue({ totalTtc: 1000, amountPaid: 1500 })).toBe(0);
  });
});

describe("invoice numbers", () => {
  it("formats and parses AAAA-NNN", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("2026-001");
    expect(formatInvoiceNumber(2026, 42)).toBe("2026-042");
    expect(formatInvoiceNumber(2026, 1000)).toBe("2026-1000");
    expect(parseInvoiceNumber("2026-042")).toEqual({ year: 2026, sequence: 42 });
    expect(parseInvoiceNumber("2026-1000")).toEqual({ year: 2026, sequence: 1000 });
    expect(parseInvoiceNumber("26-1")).toBeNull();
    expect(parseInvoiceNumber("2026-ab")).toBeNull();
  });
  it("restarts on 1 January in Abidjan time", () => {
    expect(invoiceYear(new Date("2026-12-31T23:59:59Z"))).toBe(2026);
    expect(invoiceYear(new Date("2027-01-01T00:00:00Z"))).toBe(2027);
    // Paris is one hour ahead: the same instant is already 2027 there.
    expect(invoiceYear(new Date("2026-12-31T23:30:00Z"), "Europe/Paris")).toBe(2027);
  });
});

describe("reminders", () => {
  const due = new Date("2026-10-01T00:00:00Z");
  const day = (n: number) => new Date(due.getTime() + n * 24 * 3600_000);

  it("fires 3, 10 and 20 days after the due date, in that order", () => {
    expect(isReminderDue(due, 0, day(2.9))).toBe(false);
    expect(isReminderDue(due, 0, day(3))).toBe(true);
    expect(isReminderDue(due, 1, day(9.9))).toBe(false);
    expect(isReminderDue(due, 1, day(10))).toBe(true);
    expect(isReminderDue(due, 2, day(19.9))).toBe(false);
    expect(isReminderDue(due, 2, day(20))).toBe(true);
  });
  it("never goes past three reminders", () => {
    expect(MAX_REMINDERS).toBe(3);
    expect(isReminderDue(due, 3, day(365))).toBe(false);
  });
  it("only sends the next reminder when earlier ones were already sent", () => {
    // 25 days late with nothing sent yet: the first one is due now, not the third.
    expect(isReminderDue(due, 0, day(25))).toBe(true);
    expect(isReminderDue(due, 1, day(25))).toBe(true);
  });
});

describe("formatFcfa", () => {
  it("groups thousands with plain spaces", () => {
    expect(formatFcfa(1_250_000)).toBe("1 250 000 FCFA");
    expect(formatFcfa(0)).toBe("0 FCFA");
    expect(formatFcfa(-944_000)).toBe("-944 000 FCFA");
  });
});
