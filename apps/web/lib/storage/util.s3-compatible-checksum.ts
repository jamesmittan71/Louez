const REQUEST_CHECKSUM_ENV = "AWS_REQUEST_CHECKSUM_CALCULATION";
const RESPONSE_CHECKSUM_ENV = "AWS_RESPONSE_CHECKSUM_VALIDATION";

const readEnv = (name: string): string | undefined => process.env[name];

const assignEnv = (name: string, value: string): void => {
  process.env[name] = value;
};

/**
 * files-sdk 2.1.0 builds its S3 client without `requestChecksumCalculation`.
 * `@aws-sdk/client-s3` 3.729 and newer defaults that to `WHEN_SUPPORTED` and
 * adds `x-amz-checksum-crc32` on every PutObject. S3-compatible stores that
 * do not sign that header reject the upload with AccessDenied or
 * SignatureDoesNotMatch. The files gateway maps both of those to HTTP 401 on
 * `PUT /api/files/:kind?op=proxy`, so a signed-in logo upload looks like a
 * session failure even when the MinIO credentials themselves are valid.
 *
 * The SDK reads these variables when the client is constructed, and this
 * files-sdk version has no client-option for them. Set the pre-3.729 behavior
 * (checksums only when the operation requires one) unless the operator already
 * chose a value. Call this immediately before `s3()`.
 */
export const applyS3CompatibleChecksumDefaults = (): void => {
  if (readEnv(REQUEST_CHECKSUM_ENV) === undefined) {
    assignEnv(REQUEST_CHECKSUM_ENV, "WHEN_REQUIRED");
  }
  if (readEnv(RESPONSE_CHECKSUM_ENV) === undefined) {
    assignEnv(RESPONSE_CHECKSUM_ENV, "WHEN_REQUIRED");
  }
};
