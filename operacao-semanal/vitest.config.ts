import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/services/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
