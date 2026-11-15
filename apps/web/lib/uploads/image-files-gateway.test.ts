import assert from "node:assert/strict";
import { test } from "node:test";

import { registerFilesSdkHook } from "../testing/files-sdk-hook";

registerFilesSdkHook();

const PUBLIC_ORIGIN = "https://power.102-68-97-209.sslip.io";
const SECRET = "louez-image-upload:test-secret";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const loadGateway = async () => {
  const { createFiles, FilesError } = await import("files-sdk");
  const { memory } = await import("files-sdk/memory");
  const { createImageFilesGateway } = await import("./image-files-gateway");
  return { createFiles, FilesError, memory, createImageFilesGateway };
};

type GatewayHandle = (request: Request) => Promise<Response>;

const presign = async (handle: GatewayHandle, origin = PUBLIC_ORIGIN) => {
  const response = await handle(
    new Request("http://127.0.0.1:3000/api/files/logo", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        op: "presign",
        files: [{ name: "logo.png", size: png.byteLength, type: "image/png" }],
      }),
    }),
  );
  return { status: response.status, body: await response.json() };
};

const putBytes = (url: string, headers: Record<string, string>) =>
  new Request(url, {
    method: "PUT",
    headers: { ...headers, origin: PUBLIC_ORIGIN, "content-length": String(png.byteLength) },
    body: png,
    duplex: "half",
  } as RequestInit);

test("an authorized logo upload through the proxy succeeds and keeps the public origin", async () => {
  const { createFiles, memory, createImageFilesGateway } = await loadGateway();
  const stored = memory();
  const files = createFiles({
    adapter: { ...stored, signedUrl: { supported: false as const } },
  });
  const gateway = createImageFilesGateway({
    files: () => files,
    allowedOrigins: [PUBLIC_ORIGIN],
    fallbackOrigin: "http://localhost:3000",
    maxUploadSize: 2 * 1024 * 1024,
    secret: SECRET,
    authorize: async () => ({ keyPrefix: "store123/logo/", disposition: "inline" as const }),
  });

  const opened = await presign(gateway.handle);
  assert.equal(opened.status, 200);

  const target = opened.body.uploads[0].target;
  assert.equal(new URL(target.url).origin, PUBLIC_ORIGIN);
  assert.equal(new URL(target.url).searchParams.get("op"), "proxy");
  assert.ok(new URL(target.url).searchParams.get("token"));

  const uploaded = await gateway.handle(putBytes(target.url, target.headers));
  assert.equal(uploaded.status, 200);
  assert.deepEqual(await uploaded.json(), { ok: true });

  const keys = [...stored.raw.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^store123\/logo\/[0-9a-f-]+\.png$/);
});

test("a proxy upload without a token or with a tampered token stays unauthorized", async () => {
  const { createFiles, memory, createImageFilesGateway } = await loadGateway();
  const files = createFiles({
    adapter: { ...memory(), signedUrl: { supported: false as const } },
  });
  const gateway = createImageFilesGateway({
    files: () => files,
    allowedOrigins: [PUBLIC_ORIGIN],
    fallbackOrigin: "http://localhost:3000",
    maxUploadSize: 2 * 1024 * 1024,
    secret: SECRET,
    authorize: async () => ({ keyPrefix: "store123/logo/", disposition: "inline" as const }),
  });
  const opened = await presign(gateway.handle);
  assert.equal(opened.status, 200);
  const target = opened.body.uploads[0].target;
  const url = new URL(target.url);

  url.searchParams.delete("token");
  const missing = await gateway.handle(putBytes(url.toString(), target.headers));
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.message, "missing proxy token");

  const tampered = new URL(target.url);
  const token = tampered.searchParams.get("token");
  assert.ok(token);
  tampered.searchParams.set("token", `${token.slice(0, -2)}aa`);
  const rejected = await gateway.handle(putBytes(tampered.toString(), target.headers));
  assert.equal(rejected.status, 401);
  assert.match((await rejected.json()).error.message, /upload token signature/);
});

test("a foreign origin is forbidden and is not used as the upload target", async () => {
  const { createFiles, memory, createImageFilesGateway } = await loadGateway();
  const files = createFiles({
    adapter: { ...memory(), signedUrl: { supported: false as const } },
  });
  const gateway = createImageFilesGateway({
    files: () => files,
    allowedOrigins: [PUBLIC_ORIGIN],
    fallbackOrigin: "http://localhost:3000",
    maxUploadSize: 2 * 1024 * 1024,
    secret: SECRET,
    authorize: async () => ({ keyPrefix: "store123/logo/", disposition: "inline" as const }),
  });

  const foreign = await presign(gateway.handle, "https://evil.example");
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.reason, "origin");
});
