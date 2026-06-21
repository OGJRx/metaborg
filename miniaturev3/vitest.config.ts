import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 55,
      },
      exclude: ["node_modules/", "tests/"],
    },
    alias: {
      "@borg/shared": path.resolve(__dirname, "./shared"),
    },
  },
});
