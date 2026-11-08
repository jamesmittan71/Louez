// Native ESM: the repo test loader compiles TypeScript to CommonJS, which
// splits files-sdk's FilesError class and turns a real 401 into a 500. This
// file loads the published package the same way the server does.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { createFiles, FilesError } from "files-sdk";
import { createFilesRouter } from "files-sdk/api";
import { contentType } from "files-sdk/content-type";
import { memory } from "files-sdk/memory";
import { s3 } from "files-sdk/s3";
import { validation } from "files-sdk/validation";

const createPublicFilesRequest = (request, allowedOrigins, fallbackOrigin) => {
  const requestOrigin = request.headers.get("origin");
  const publicOrigin =
    requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : fallbackOrigin;
  const requestUrl = new URL(request.url);
  const publicUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, publicOrigin);
  return new Request(publicUrl, request);
};

const createImageFilesGateway = ({
  files,
  allowedOrigins,
  fallbackOrigin,
  maxUploadSize,
  secret,
  authorize,
}) => {
  const router = createFilesRouter({
    files,
    operations: ["upload", "url", "delete"],
    allowedOrigins,
    maxUploadSize,
    secret,
    authorize,
  });
  return {
    handle: (request) =>
      router.handle(createPublicFilesRequest(request, allowedOrigins, fallbackOrigin)),
  };
};

const PUBLIC_ORIGIN = "https://power.102-68-97-209.sslip.io";
const SECRET = "louez-image-upload:test-secret";
const REQUEST_CHECKSUM_ENV = "AWS_REQUEST_CHECKSUM_CALCULATION";
const RESPONSE_CHECKSUM_ENV = "AWS_RESPONSE_CHECKSUM_VALIDATION";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const listen = async (onRequest) => {
  const server = createServer(onRequest);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

test("presign without a store session is 401 and a foreign origin is forbidden", async () => {
  const gateway = createImageFilesGateway({
    files: () => createFiles({ adapter: { ...memory(), signedUrl: { supported: false } } }),
    allowedOrigins: [PUBLIC_ORIGIN],
    fallbackOrigin: "http://localhost:3000",
    maxUploadSize: 2 * 1024 * 1024,
    secret: SECRET,
    authorize: async () => {
      throw new FilesError("Unauthorized", "Store access required");
    },
  });

  const denied = await gateway.handle(
    new Request("http://127.0.0.1:3000/api/files/logo", {
      method: "POST",
      headers: { origin: PUBLIC_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        op: "presign",
        files: [{ name: "logo.png", size: png.byteLength, type: "image/png" }],
      }),
    }),
  );
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.message, "Store access required");

  const foreign = await gateway.handle(
    new Request("http://127.0.0.1:3000/api/files/logo", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({
        op: "presign",
        files: [{ name: "logo.png", size: png.byteLength, type: "image/png" }],
      }),
    }),
  );
  assert.equal(foreign.status, 403);
});

test("a strict store turns the default checksum upload into HTTP 401, and required-only checksums let the authorized upload succeed", async () => {
  const captured = [];
  const server = await listen(async (request, response) => {
    request.on("data", () => undefined);
    await once(request, "end");
    const checksum = request.headers["x-amz-checksum-crc32"];
    captured.push(checksum);
    if (checksum) {
      response.writeHead(403, { "content-type": "application/xml" });
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided. Check your key and signing method.</Message></Error>`,
      );
      return;
    }
    response.writeHead(200, { etag: '"abc"' });
    response.end();
  });

  const previousRequest = process.env[REQUEST_CHECKSUM_ENV];
  const previousResponse = process.env[RESPONSE_CHECKSUM_ENV];
  delete process.env[REQUEST_CHECKSUM_ENV];
  delete process.env[RESPONSE_CHECKSUM_ENV];

  const uploadLogo = async () => {
    const adapter = s3({
      bucket: "louez",
      region: "us-east-1",
      endpoint: server.url,
      forcePathStyle: true,
      credentials: { accessKeyId: "louez", secretAccessKey: "louez-minio-secret" },
      publicBaseUrl: "/files",
    });
    const files = createFiles({
      adapter: { ...adapter, signedUrl: { supported: false } },
      plugins: [
        contentType({ onMismatch: "reject", onUnknown: "reject" }),
        validation({
          minSize: 1,
          allowedTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
          key: /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|gif|webp)$/,
        }),
      ],
    });
    const gateway = createImageFilesGateway({
      files: () => files,
      allowedOrigins: [PUBLIC_ORIGIN],
      fallbackOrigin: "http://127.0.0.1:3000",
      maxUploadSize: 2 * 1024 * 1024,
      secret: SECRET,
      authorize: async () => ({ keyPrefix: "store123/logo/", disposition: "inline" }),
    });
    const opened = await gateway.handle(
      new Request("http://127.0.0.1:3000/api/files/logo", {
        method: "POST",
        headers: { origin: PUBLIC_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          op: "presign",
          files: [{ name: "logo.png", size: png.byteLength, type: "image/png" }],
        }),
      }),
    );
    assert.equal(opened.status, 200);
    const target = (await opened.json()).uploads[0].target;
    const uploaded = await gateway.handle(
      new Request(target.url, {
        method: "PUT",
        headers: {
          ...target.headers,
          origin: PUBLIC_ORIGIN,
          "content-length": String(png.byteLength),
        },
        body: png,
        duplex: "half",
      }),
    );
    return { status: uploaded.status, body: await uploaded.json() };
  };

  try {
    const rejected = await uploadLogo();
    assert.equal(rejected.status, 401);
    assert.match(rejected.body.error.message, /signature we calculated does not match/);
    assert.ok(captured.at(-1));

    process.env[REQUEST_CHECKSUM_ENV] = "WHEN_REQUIRED";
    process.env[RESPONSE_CHECKSUM_ENV] = "WHEN_REQUIRED";
    const accepted = await uploadLogo();
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, { ok: true });
    assert.equal(captured.at(-1), undefined);
  } finally {
    if (previousRequest === undefined) delete process.env[REQUEST_CHECKSUM_ENV];
    else process.env[REQUEST_CHECKSUM_ENV] = previousRequest;
    if (previousResponse === undefined) delete process.env[RESPONSE_CHECKSUM_ENV];
    else process.env[RESPONSE_CHECKSUM_ENV] = previousResponse;
    await server.close();
  }
});
