// Types
export * from "./types";

// Calculation utilities
export {
  calculateDuration,
  calculateDurationMinutes,
  findApplicableTier,
  calculateEffectivePrice,
  calculateRentalPrice,
  calculateFixedPrice,
  calculateRateBasedPrice,
  calculateUnitPrice,
  generatePricingBreakdown,
  getPricingModeLabel,
  validatePricingTiers,
  sortTiersByDuration,
  getAvailableDurations,
  snapToNearestTier,
  getAvailableDurationMinutes,
  snapToNearestRatePeriod,
  isRateBasedProduct,
  roundCurrency,
  isFixedPriceProduct,
} from "./calculate";

export {
  type DurationUnit,
  priceDurationToMinutes,
  minutesToPriceDuration,
  tierDisplayMaxUnit,
  pricingModeToMinutes,
  perMinuteCost,
  computeReductionPercent,
} from "./conversions";

// Tax utilities
export {
  QUOTE_CHARGE_KINDS,
  type QuoteChargeKind,
  type QuoteChargeInput,
  type QuoteChargeResult,
  type CommercialLineInput,
  type CommercialLinePresentation,
  type DashboardQuoteTaxLine,
  type DashboardQuoteTaxColumns,
  type DashboardQuoteTaxLineResult,
  type DashboardQuoteTaxResult,
  readQuoteChargeKind,
  hasDeliveryAndDistanceConflict,
  readProductTaxSettings,
  priceQuoteCharge,
  presentCommercialLine,
  buildDashboardQuoteTax,
  quoteLineTaxRate,
} from "./quote-charges";

export {
  type TaxConfig,
  type PriceCalculationResultWithTax,
  type TaxableLine,
  type TaxLineCalculation,
  type VatBreakdownEntry,
  type TaxBreakdownCalculation,
  type CalculateTaxBreakdownInput,
  calculateTaxFromExclusive,
  extractExclusiveFromInclusive,
  extractTaxFromInclusive,
  taxSettingsToConfig,
  getEffectiveTaxRate,
  calculateTaxBreakdown,
  applyTaxToCalculation,
  calculateRentalPriceWithTax,
  formatTaxLabel,
} from "./tax";

// Seasonal pricing
export {
  findSeasonalPricingForDate,
  buildRawSegments,
  calculateSeasonalAwarePrice,
} from "./seasonal";

// Formatting utilities
export {
  formatDuration,
  formatPricePerUnit,
  formatTierLabel,
  formatDiscount,
  getPriceDisplayInfo,
  generateDurationPreviews,
  formatPricingSummary,
  getUnitLabel,
  formatSavingsBadge,
  formatTierBadge,
} from "./format";
