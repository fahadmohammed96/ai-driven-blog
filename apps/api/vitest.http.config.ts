import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// HTTP tests that boot the Nest app need decorator metadata: swc transform
// (esbuild does not emit emitDecoratorMetadata). Isolated here so the rest of
// the suite keeps using the default (faster) transform.
export default defineConfig({
  test: {
    include: ["**/*.http.test.ts"],
    testTimeout: 30_000,
  },
  plugins: [
    swc.vite({
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
