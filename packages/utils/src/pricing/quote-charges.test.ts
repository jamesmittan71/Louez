import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDashboardQuoteTax,
  presentCommercialLine,
  priceQuoteCharge,
  readQuoteChargeKind,
} from "./quote-charges";

test("a hire span is charged once, and one-off and distance lines do not repeat with it", () => {
  const rentalDuration = 5;
  const hire = priceQuoteCharge({
    chargeKind: "duration",
    rate: 100,
    quantity: 1,
    rentalDuration,
  });
  const commissioning = priceQuoteCharge({
    chargeKind: "once",
    rate: 250,
    quantity: 1,
    rentalDuration,
  });
  const collection = priceQuoteCharge({
    chargeKind: "once",
    rate: 180,
    quantity: 1,
    rentalDuration,
  });
  const transport = priceQuoteCharge({
    chargeKind: "distance",
    rate: 12,
    quantity: 4,
    billedQuantity: 40,
    rentalDuration,
  });

  assert.equal(hire.total, 500);
  assert.equal(hire.duration, 5);
  assert.equal(commissioning.total, 250);
  assert.equal(commissioning.duration, 1);
  assert.equal(collection.total, 180);
  assert.equal(transport.total, 480);
  assert.equal(transport.stockQuantity, 1);
  assert.equal(transport.billedQuantity, 40);
  assert.equal(hire.total + commissioning.total + collection.total + transport.total, 1410);

  assert.equal(
    priceQuoteCharge({ chargeKind: "once", rate: 250, quantity: 1, rentalDuration: 12 }).total,
    250,
  );
  assert.equal(
    priceQuoteCharge({
      chargeKind: "distance",
      rate: 12,
      quantity: 1,
      billedQuantity: 40,
      rentalDuration: 12,
    }).total,
    480,
  );
});

test("a missing charge kind keeps the existing duration multiplication", () => {
  assert.equal(readQuoteChargeKind(undefined), "duration");
  assert.equal(readQuoteChargeKind("week-package"), "duration");
  const line = priceQuoteCharge({ rate: 80, quantity: 2, rentalDuration: 3 });
  assert.equal(line.chargeKind, "duration");
  assert.equal(line.total, 480);
  assert.equal(line.stockQuantity, 2);
});

test("documents show a rate times the billed quantity, and kilometres are not stock", () => {
  const hire = presentCommercialLine({
    name: "Generator hire",
    chargeKind: "duration",
    isCustomItem: true,
    isManualOverride: true,
    storedQuantity: 1,
    duration: 5,
    total: 500,
    amountExclTax: 500,
  });
  assert.equal(hire.quantity, 5);
  assert.equal(hire.unitPrice, 100);
  assert.equal(Math.round(hire.unitPrice * hire.quantity * 100) / 100, 500);

  const commissioning = presentCommercialLine({
    name: "Commissioning",
    description: "Site arrival and start-up for this job",
    chargeKind: "once",
    isCustomItem: true,
    storedQuantity: 1,
    duration: 5,
    total: 250,
    amountExclTax: 250,
  });
  assert.equal(commissioning.quantity, 1);
  assert.equal(commissioning.unitPrice, 250);
  assert.equal(commissioning.description, "Commissioning — Site arrival and start-up for this job");

  const transport = presentCommercialLine({
    name: "Transport",
    description: "Travel charged from the entered distance",
    chargeKind: "distance",
    isCustomItem: true,
    storedQuantity: 1,
    billedQuantity: 40,
    duration: 5,
    total: 480,
    amountExclTax: 480,
  });
  assert.equal(transport.quantity, 40);
  assert.equal(transport.unitPrice, 12);

  const catalogue = presentCommercialLine({
    name: "Catalogue generator",
    description: "Marketing text that stays off the quote line",
    isCustomItem: false,
    isManualOverride: false,
    storedQuantity: 2,
    duration: 5,
    total: 1000,
    amountExclTax: 1000,
  });
  assert.equal(catalogue.quantity, 2);
  assert.equal(catalogue.unitPrice, 500);
  assert.equal(catalogue.note, null);
});

test("dashboard VAT follows the store rate and does not tax an exempt line twice", () => {
  const exclusive = buildDashboardQuoteTax({
    lines: [
      { id: "hire", amount: 500, taxRate: 15, quantity: 1, unitRate: 100 },
      { id: "commissioning", amount: 250, taxRate: 15, quantity: 1, unitRate: 250 },
      { id: "collection", amount: 180, taxRate: 15, quantity: 1, unitRate: 180 },
      { id: "transport", amount: 480, taxRate: 15, quantity: 1, unitRate: 12 },
      { id: "insurance", amount: 80, taxRate: null, quantity: 1, unitRate: 80 },
    ],
    deliveryFee: 0,
    discountAmount: 0,
    depositAmount: 400,
    taxSettings: { enabled: true, defaultRate: 15, displayMode: "exclusive" },
  });

  assert.equal(exclusive.taxAmount, 211.5);
  assert.equal(exclusive.subtotalExclTax, 1490);
  assert.equal(exclusive.totalAmount, 1701.5);
  assert.equal(exclusive.lines.find((line) => line.id === "insurance")?.taxAmount, null);
  assert.equal(exclusive.lines.find((line) => line.id === "commissioning")?.taxAmount, "37.50");

  const inclusive = buildDashboardQuoteTax({
    lines: [{ id: "hire", amount: 115, taxRate: 15, quantity: 1, unitRate: 115 }],
    deliveryFee: 0,
    discountAmount: 0,
    depositAmount: 0,
    taxSettings: { enabled: true, defaultRate: 15, displayMode: "inclusive" },
  });
  assert.equal(inclusive.totalAmount, 115);
  assert.equal(inclusive.taxAmount, 15);
  assert.equal(inclusive.subtotalExclTax, 100);

  const disabled = buildDashboardQuoteTax({
    lines: [
      { id: "hire", amount: 500, taxRate: null, quantity: 1, unitRate: 100 },
      { id: "commissioning", amount: 250, taxRate: null, quantity: 1, unitRate: 250 },
    ],
    deliveryFee: 20,
    discountAmount: 0,
    depositAmount: 0,
    taxSettings: { enabled: false, defaultRate: 15, displayMode: "exclusive" },
  });
  assert.equal(disabled.taxEnabled, false);
  assert.equal(disabled.taxAmount, null);
  assert.equal(disabled.totalAmount, 770);
  assert.equal(disabled.lines[0]?.taxRate, null);
});
