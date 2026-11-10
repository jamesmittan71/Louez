import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

interface ResolveContext {
  parentURL?: string;
}
interface LoadContext {
  format?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };
type NextLoad = (url: string, context: LoadContext) => { format?: string; source?: unknown };

const STORE_KEY = "__louezActionsTestStore";
const STUB_SCHEME = "louez-actions-test:";
const STUBS: Record<string, string> = {
  "next/cache": "export function revalidatePath() {}\n",
  "@/lib/auth": "export async function auth() { return null; }\n",
  "@/lib/store-context": `export async function getCurrentStore() { return globalThis[${JSON.stringify(STORE_KEY)}] ?? null; }\n`,
  "@/lib/notifications/customer-dispatcher":
    "export async function dispatchCustomerNotification() {}\n",
};
const ACTIONS_FILE = "/dashboard/reservations/actions.ts";
const FILES_SDK = new URL("../../../../node_modules/files-sdk/dist/", import.meta.url);

const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { shortCircuit: true, url: new URL(entry, FILES_SDK).href };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.endsWith(ACTIONS_FILE) && specifier in STUBS) {
      return { shortCircuit: true, url: `${STUB_SCHEME}${specifier}` };
    }
    return nextResolve(specifier, context);
  },
  load(url: string, context: LoadContext, nextLoad: NextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
      return { shortCircuit: true, format: "module", source: STUBS[url.slice(STUB_SCHEME.length)] };
    }
    return nextLoad(url, context);
  },
});

const STORE = "store_actions_ht";
const START = new Date("2026-04-10T09:00:00.000Z");
const END = new Date("2026-04-12T09:00:00.000Z");

describe("dashboard reservation edit VAT (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("dashboard_reservation_edit_vat");
    louezDb = await import("@louez/db");
    actions = await import("./actions");

    await louezDb.db.insert(louezDb.customers).values({
      id: "customer_actions_ht",
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      userId: "",
      name: "HT",
      slug: "actions-ht",
      settings: {
        reservationMode: "request",
        advanceNoticeMinutes: 0,
        currency: "eur",
        tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
      },
      stripeAccountId: null,
    });
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
  });

  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("an edited checkout booking keeps its before-tax subtotal and VAT split", async () => {
    await louezDb.db.insert(louezDb.products).values({
      id: "product_actions_ht",
      storeId: STORE,
      name: "Bike",
      price: "50.00",
      pricingMode: "day",
    });

    const reservationId = "reservation_actions_ht";
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "customer_actions_ht",
      number: reservationId,
      status: "pending",
      startDate: START,
      endDate: END,
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "120.00",
      subtotalExclTax: "100.00",
      taxAmount: "20.00",
      taxRate: "20.00",
      source: "online",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: "item_actions_ht",
      reservationId,
      productId: "product_actions_ht",
      quantity: 1,
      unitPrice: "50.00",
      depositPerUnit: "0.00",
      totalPrice: "100.00",
      taxRate: "20.00",
      taxAmount: "20.00",
      priceExclTax: "50.00",
      totalExclTax: "100.00",
      productSnapshot: { name: "Bike", description: null, images: [] },
    });

    const result = await actions.updateReservation(reservationId, {
      endDate: new Date("2026-04-13T09:00:00.000Z"),
    });
    assert.equal("error" in result ? result.error : undefined, undefined);

    const [row] = await louezDb.db
      .select({
        subtotalAmount: louezDb.reservations.subtotalAmount,
        subtotalExclTax: louezDb.reservations.subtotalExclTax,
        taxAmount: louezDb.reservations.taxAmount,
        taxRate: louezDb.reservations.taxRate,
        totalAmount: louezDb.reservations.totalAmount,
      })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, reservationId));
    assert.equal(row?.subtotalAmount, "150.00");
    assert.equal(row?.subtotalExclTax, "150.00");
    assert.equal(row?.taxAmount, "30.00");
    assert.equal(row?.taxRate, "20.00");
    assert.equal(row?.totalAmount, "180.00");
  });
});
