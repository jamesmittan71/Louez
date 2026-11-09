import type { ProductTaxSettings, TaxSettings } from "@louez/types";

import { roundCurrency } from "./calculate";
import {
  calculateTaxBreakdown,
  extractExclusiveFromInclusive,
  getEffectiveTaxRate,
  taxSettingsToConfig,
  type TaxLineCalculation,
} from "./tax";

/**
 * How one dashboard quote line is multiplied.
 *
 * `duration` keeps the installed elapsed-period hire (hour, day, or week).
 * `once` is a named fee charged once for the job.
 * `distance` is an entered kilometre quantity times an entered rate.
 *
 * None of these choose a calendar month, a 7-day package, or a second hire
 * charge for the first and last day. Those rules are not configured here.
 */
export const QUOTE_CHARGE_KINDS = ["duration", "once", "distance"] as const;

export type QuoteChargeKind = (typeof QUOTE_CHARGE_KINDS)[number];

export function readQuoteChargeKind(value: unknown): QuoteChargeKind {
  if (value === "once" || value === "distance" || value === "duration") {
    return value;
  }
  return "duration";
}

export function hasDeliveryAndDistanceConflict(
  deliveryFee: number,
  chargeKinds: readonly unknown[],
): boolean {
  return (
    Number.isFinite(deliveryFee) &&
    deliveryFee > 0 &&
    chargeKinds.some((chargeKind) => readQuoteChargeKind(chargeKind) === "distance")
  );
}

export function readProductTaxSettings(value: unknown): ProductTaxSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("inheritFromStore" in value) || typeof value.inheritFromStore !== "boolean") return null;
  const customRate =
    "customRate" in value && typeof value.customRate === "number" ? value.customRate : undefined;
  return {
    inheritFromStore: value.inheritFromStore,
    customRate,
  };
}

export interface QuoteChargeInput {
  chargeKind?: unknown;
  /** Rate per hire period, per one-off unit, or per kilometre. */
  rate: number;
  /** Count of units or one-off fees. Distance lines do not use this as kilometres. */
  quantity: number;
  /** Kilometres. Used only when the charge is distance. */
  billedQuantity?: number | null;
  /**
   * Hire periods already counted for the reservation span.
   * Ignored by one-off and distance lines.
   */
  rentalDuration: number;
}

export interface QuoteChargeResult {
  chargeKind: QuoteChargeKind;
  rate: number;
  /** Value stored on the reservation line. Never a kilometre count. */
  stockQuantity: number;
  billedQuantity: number | null;
  /** Periods multiplied into the money. Always 1 for one-off and distance. */
  duration: number;
  total: number;
}

function positive(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function wholeCount(value: number): number {
  const count = positive(value);
  if (count === null) return 1;
  return Math.max(1, Math.round(count));
}

/**
 * Price one explicit quote line.
 *
 * A duration line is the hire for the span that was passed in. It does not
 * add the first or last day again. A one-off fee stays the entered amount
 * when the span changes. A distance line is kilometres times the entered
 * rate and does not reserve stock.
 */
export function priceQuoteCharge(input: QuoteChargeInput): QuoteChargeResult {
  const chargeKind = readQuoteChargeKind(input.chargeKind);
  const rate = Number.isFinite(input.rate) ? input.rate : 0;
  const rentalDuration = positive(input.rentalDuration) ?? 1;

  if (chargeKind === "distance") {
    const kilometres = positive(input.billedQuantity) ?? 0;
    return {
      chargeKind,
      rate,
      stockQuantity: 1,
      billedQuantity: kilometres,
      duration: 1,
      total: roundCurrency(rate * kilometres),
    };
  }

  const stockQuantity = wholeCount(input.quantity);
  if (chargeKind === "once") {
    return {
      chargeKind,
      rate,
      stockQuantity,
      billedQuantity: null,
      duration: 1,
      total: roundCurrency(rate * stockQuantity),
    };
  }

  return {
    chargeKind: "duration",
    rate,
    stockQuantity,
    billedQuantity: null,
    duration: rentalDuration,
    total: roundCurrency(rate * rentalDuration * stockQuantity),
  };
}

export interface CommercialLineInput {
  name: string;
  description?: string | null;
  chargeKind?: unknown;
  isManualOverride?: boolean;
  isCustomItem?: boolean;
  pricingKind?: unknown;
  storedQuantity: number;
  total: number;
  duration?: number | null;
  billedQuantity?: number | null;
  /** Exclusive amount the document should split across the displayed quantity. */
  amountExclTax?: number | null;
}

export interface CommercialLinePresentation {
  name: string;
  note: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
}

function normalizeDocumentQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.round(value * 1000) / 1000;
}

function lineNote(input: CommercialLineInput): string | null {
  if (!input.isCustomItem) return null;
  const note = input.description?.trim();
  if (!note || note === input.name.trim()) return null;
  return note;
}

/**
 * Quantity and unit price shown on the contract and the invoice.
 *
 * Manual and custom hire lines show periods times units, so the rate times
 * that quantity equals the line. Catalogue lines that already store an
 * extended unit price keep their stored quantity. One-off lines keep their
 * count. Distance lines show kilometres, not a stock count.
 */
export function presentCommercialLine(input: CommercialLineInput): CommercialLinePresentation {
  const chargeKind = readQuoteChargeKind(input.chargeKind);
  const amount =
    typeof input.amountExclTax === "number" && Number.isFinite(input.amountExclTax)
      ? input.amountExclTax
      : input.total;
  const note = lineNote(input);
  const description = note ? `${input.name} — ${note}` : input.name;
  const storedQuantity = positive(input.storedQuantity) ?? 1;

  if (chargeKind === "distance") {
    const quantity = normalizeDocumentQuantity(positive(input.billedQuantity) ?? 1);
    return {
      name: input.name,
      note,
      description,
      quantity,
      unitPrice: roundCurrency(amount / quantity),
    };
  }

  if (chargeKind === "once" || input.pricingKind === "fixed") {
    return {
      name: input.name,
      note,
      description,
      quantity: storedQuantity,
      unitPrice: roundCurrency(amount / storedQuantity),
    };
  }

  const expandDuration = input.isCustomItem === true || input.isManualOverride === true;
  if (expandDuration) {
    const periods = positive(input.duration) ?? 1;
    const quantity = normalizeDocumentQuantity(periods * storedQuantity);
    return {
      name: input.name,
      note,
      description,
      quantity,
      unitPrice: roundCurrency(amount / quantity),
    };
  }

  return {
    name: input.name,
    note: null,
    description: input.name,
    quantity: storedQuantity,
    unitPrice: roundCurrency(amount / storedQuantity),
  };
}

export interface DashboardQuoteTaxLine {
  id: string;
  amount: number;
  taxRate: number | null;
  quantity: number;
  unitRate: number;
}

export interface DashboardQuoteTaxColumns {
  taxRate: string | null;
  taxAmount: string | null;
  priceExclTax: string | null;
  totalExclTax: string | null;
}

export interface DashboardQuoteTaxLineResult extends DashboardQuoteTaxColumns {
  id: string;
  breakdownTax: {
    taxRate: number | null;
    taxAmount: number | null;
    subtotalExclTax: number | null;
    subtotalInclTax: number | null;
  };
}

export interface DashboardQuoteTaxResult {
  taxEnabled: boolean;
  displayMode: "inclusive" | "exclusive";
  taxRate: number | null;
  subtotalExclTax: number | null;
  taxAmount: number | null;
  totalAmount: number;
  lines: DashboardQuoteTaxLineResult[];
}

function money(value: number): string {
  return roundCurrency(value).toFixed(2);
}

function emptyTaxColumns(): DashboardQuoteTaxColumns {
  return {
    taxRate: null,
    taxAmount: null,
    priceExclTax: null,
    totalExclTax: null,
  };
}

/**
 * VAT for a dashboard quote. The store rate is an input. 15% is not assumed.
 * Insurance and other lines with a null rate stay exempt. Deposits are not
 * taxed and are not included in the customer total.
 */
export function buildDashboardQuoteTax(input: {
  lines: DashboardQuoteTaxLine[];
  deliveryFee: number;
  discountAmount: number;
  depositAmount: number;
  taxSettings?: TaxSettings;
}): DashboardQuoteTaxResult {
  const taxConfig = taxSettingsToConfig(input.taxSettings);
  const taxEnabled = taxConfig?.enabled ?? false;
  const displayMode = taxConfig?.displayMode ?? "inclusive";
  const calculation = calculateTaxBreakdown({
    lines: input.lines.map((line) => ({
      id: line.id,
      amount: line.amount,
      taxRate: line.taxRate,
    })),
    deliveryFee: input.deliveryFee,
    discountAmount: input.discountAmount,
    depositAmount: input.depositAmount,
    taxConfig,
  });
  const byId = new Map<string, TaxLineCalculation>(
    calculation.lines.map((line) => [line.id, line]),
  );

  return {
    taxEnabled,
    displayMode,
    taxRate: taxEnabled ? (taxConfig?.rate ?? null) : null,
    subtotalExclTax: taxEnabled ? calculation.subtotalExclTax : null,
    taxAmount: taxEnabled ? calculation.taxAmount : null,
    totalAmount: calculation.totalInclTax,
    lines: input.lines.map((line) => {
      const taxed = byId.get(line.id);
      if (!taxEnabled || !taxed || taxed.taxRate === null) {
        return {
          id: line.id,
          ...emptyTaxColumns(),
          breakdownTax: {
            taxRate: null,
            taxAmount: null,
            subtotalExclTax: null,
            subtotalInclTax: null,
          },
        };
      }

      const priceExclTax =
        displayMode === "inclusive"
          ? extractExclusiveFromInclusive(line.unitRate, taxed.taxRate)
          : roundCurrency(line.unitRate);

      return {
        id: line.id,
        taxRate: money(taxed.taxRate),
        taxAmount: money(taxed.taxAmount),
        priceExclTax: money(priceExclTax),
        totalExclTax: money(taxed.amountExclTax),
        breakdownTax: {
          taxRate: taxed.taxRate,
          taxAmount: taxed.taxAmount,
          subtotalExclTax: taxed.amountExclTax,
          subtotalInclTax: taxed.amountInclTax,
        },
      };
    }),
  };
}

export function quoteLineTaxRate(
  taxSettings: TaxSettings | undefined,
  productTaxSettings: ProductTaxSettings | null | undefined,
): number | null {
  return getEffectiveTaxRate(taxSettingsToConfig(taxSettings), productTaxSettings);
}
