import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { applyS3CompatibleChecksumDefaults } from "./util.s3-compatible-checksum";

const REQUEST_CHECKSUM_ENV = "AWS_REQUEST_CHECKSUM_CALCULATION";
const RESPONSE_CHECKSUM_ENV = "AWS_RESPONSE_CHECKSUM_VALIDATION";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde,
]);

const listen = async (
  onRequest: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = createServer(onRequest);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

test("the image storage client applies the compatible checksum defaults before opening S3", () => {
  const source = readFileSync(new URL("./files.ts", import.meta.url), "utf8");
  const call = source.indexOf("applyS3CompatibleChecksumDefaults()");
  const client = source.indexOf("s3({");
  assert.ok(call !== -1 && client !== -1 && call < client);
});

test("checksum defaults remove the CRC32 header a strict store rejects, without overriding an operator", async () => {
  const captured: Array<string | undefined> = [];
  const server = await listen((request, response) => {
    request.resume();
    request.on("end", () => {
      const checksum = request.headers["x-amz-checksum-crc32"];
      captured.push(Array.isArray(checksum) ? checksum[0] : checksum);
      if (checksum) {
        response.writeHead(403, { "content-type": "application/xml" });
        response.end(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>`,
        );
        return;
      }
      response.writeHead(200, { etag: '"abc"' });
      response.end();
    });
  });

  const previousRequest = process.env[REQUEST_CHECKSUM_ENV];
  const previousResponse = process.env[RESPONSE_CHECKSUM_ENV];
  delete process.env[REQUEST_CHECKSUM_ENV];
  delete process.env[RESPONSE_CHECKSUM_ENV];

  const put = (endpoint: string) => {
    const client = new S3Client({
      region: "us-east-1",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: "louez", secretAccessKey: "louez-minio-secret" },
    });
    return client.send(
      new PutObjectCommand({
        Bucket: "louez",
        Key: "store/logo/logo.png",
        Body: png,
        ContentType: "image/png",
      }),
    );
  };

  try {
    await assert.rejects(put(server.url));
    assert.ok(captured.at(-1));

    applyS3CompatibleChecksumDefaults();
    await put(server.url);
    assert.equal(captured.at(-1), undefined);

    process.env[REQUEST_CHECKSUM_ENV] = "WHEN_SUPPORTED";
    applyS3CompatibleChecksumDefaults();
    assert.equal(process.env[REQUEST_CHECKSUM_ENV], "WHEN_SUPPORTED");
  } finally {
    if (previousRequest === undefined) delete process.env[REQUEST_CHECKSUM_ENV];
    else process.env[REQUEST_CHECKSUM_ENV] = previousRequest;
    if (previousResponse === undefined) delete process.env[RESPONSE_CHECKSUM_ENV];
    else process.env[RESPONSE_CHECKSUM_ENV] = previousResponse;
    await server.close();
  }
});
