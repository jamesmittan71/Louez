import { createFilesRouter, type CreateFilesRouterOptions, type FilesApi } from "files-sdk/api";

import { createPublicFilesRequest } from "./util.public-files-request";

export interface ImageFilesGatewayOptions {
  files: CreateFilesRouterOptions["files"];
  allowedOrigins: readonly string[];
  fallbackOrigin: string;
  maxUploadSize: number;
  secret: string;
  authorize: NonNullable<CreateFilesRouterOptions["authorize"]>;
}

/**
 * The image upload gateway: presign mints an HMAC token, and the proxied PUT
 * is authorized by that token (not by a second session check). The browser
 * origin is rewritten onto the request URL first so the token's upload target
 * stays on the public host when the app is behind a reverse proxy.
 */
export const createImageFilesGateway = ({
  files,
  allowedOrigins,
  fallbackOrigin,
  maxUploadSize,
  secret,
  authorize,
}: ImageFilesGatewayOptions): FilesApi => {
  const origins = [...allowedOrigins];
  const router = createFilesRouter({
    files,
    operations: ["upload", "url", "delete"],
    allowedOrigins: origins,
    maxUploadSize,
    secret,
    authorize,
  });

  return {
    handle: (request: Request) =>
      router.handle(createPublicFilesRequest(request, origins, fallbackOrigin)),
  };
};
