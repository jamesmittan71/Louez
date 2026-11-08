import { realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

interface ResolveContext {
  parentURL?: string;
}

interface LoadContext {
  format?: string;
}

type NextResolve = (specifier: string, context: ResolveContext) => { url: string };
type NextLoad = (url: string, context: LoadContext) => { format?: string; source?: unknown };

const FILES_SDK = pathToFileURL(
  `${realpathSync(fileURLToPath(new URL("../../node_modules/files-sdk/dist", import.meta.url)))}/`,
);

let registered = false;

/**
 * files-sdk publishes ESM only, under an `import` condition. The test runner
 * loads TypeScript as CommonJS, and that condition is then invisible.
 */
export const registerFilesSdkHook = (): void => {
  if (registered) return;
  registered = true;

  const registerHooks = Reflect.get(nodeModule, "registerHooks");
  if (typeof registerHooks !== "function") {
    throw new Error("This test requires node:module registerHooks");
  }

  registerHooks({
    resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
      if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
        const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
        return { shortCircuit: true, url: new URL(entry, FILES_SDK).href };
      }
      return nextResolve(specifier, context);
    },
    load(url: string, context: LoadContext, nextLoad: NextLoad) {
      return nextLoad(url, context);
    },
  });
};
