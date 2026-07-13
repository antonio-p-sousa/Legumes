import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "app/services/**/*.test.ts",
      "test/**/*.test.ts",
      "prisma/**/*.test.ts",
    ],
    environment: "node",
  },
});
