import type { LegMethod } from "@louez/types";

import type {
  CustomItem,
  DeliveryAddress,
  Product,
  ProductPricingDetails,
  ReservationLocationOption,
  SelectedProduct,
} from "../types";

export interface ReservationRecapItemLine {
  id: string;
  name: string;
  quantity: number;
  /** Rendered as `key: value` chips; empty for products without booking axes. */
  attributes: string[];
  total: number;
  /** The admin replaced the computed price on this line. */
  hasPriceOverride: boolean;
}

export interface ReservationRecapDeliveryLeg {
  method: LegMethod;
  /** Store name for a pickup, formatted address for a delivery, `null` when unresolved. */
  label: string | null;
  fee: number;
}

interface BuildRecapItemLinesParams {
  selectedProducts: SelectedProduct[];
  customItems: CustomItem[];
  products: Product[];
  getProductPricingDetails: (
    product: Product,
    selectedItem?: SelectedProduct,
  ) => ProductPricingDetails;
  getCustomItemTotal: (item: CustomItem) => number;
}

function formatLineAttributes(attributes: SelectedProduct["selectedAttributes"]): string[] {
  if (!attributes) {
    return [];
  }

  // Same ordering as the products step, so a line reads identically in both places.
  return Object.entries(attributes)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, value]) => `${key}: ${value}`);
}

/**
 * Flattens product lines and custom items into a single ordered recap list.
 * Lines whose product is missing from the catalogue are dropped — they carry
 * no price in the totals either.
 */
export function buildRecapItemLines({
  selectedProducts,
  customItems,
  products,
  getProductPricingDetails,
  getCustomItemTotal,
}: BuildRecapItemLinesParams): ReservationRecapItemLine[] {
  const productLines = selectedProducts.flatMap<ReservationRecapItemLine>((line) => {
    const product = products.find((item) => item.id === line.productId);
    if (!product) {
      return [];
    }

    const pricing = getProductPricingDetails(product, line);

    return [
      {
        id: line.lineId,
        name: product.name,
        quantity: line.quantity,
        attributes: formatLineAttributes(line.selectedAttributes),
        total: pricing.lineSubtotal,
        hasPriceOverride: pricing.hasPriceOverride,
      },
    ];
  });

  const customLines = customItems.map<ReservationRecapItemLine>((item) => ({
    id: item.id,
    name: item.name,
    quantity:
      item.chargeKind === "distance" ? (item.billedQuantity ?? item.quantity) : item.quantity,
    attributes: [],
    total: getCustomItemTotal(item),
    hasPriceOverride: false,
  }));

  return [...productLines, ...customLines];
}

interface BuildRecapDeliveryLegParams {
  method: LegMethod;
  locationId: string | null;
  address: DeliveryAddress;
  fee: number;
  locations: ReservationLocationOption[];
}

/**
 * Resolves one delivery leg to what the recap shows: where it happens and
 * what it costs. Store legs fall back to the first location, mirroring the
 * delivery step's own selection.
 */
export function buildRecapDeliveryLeg({
  method,
  locationId,
  address,
  fee,
  locations,
}: BuildRecapDeliveryLegParams): ReservationRecapDeliveryLeg {
  if (method === "address") {
    const label = [address.address, address.postalCode, address.city]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");

    return { method, label: label || null, fee };
  }

  const location = locations.find((item) => item.id === locationId) ?? locations[0];

  return { method, label: location?.name ?? null, fee };
}
