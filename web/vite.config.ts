import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    include: ["src/lib/domain/**/*.test.ts"],
    environment: "node",
    globals: true,
    passWithNoTests: false,
  },
});
