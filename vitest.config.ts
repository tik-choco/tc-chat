import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: "happy-dom",
    // Node 22+ ships an experimental global localStorage that otherwise
    // shadows happy-dom's implementation (missing e.g. .clear()).
    execArgv: ["--no-experimental-webstorage"],
  },
});
