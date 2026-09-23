import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // These workspace packages are edited alongside the web app. Keeping
    // them out of Vite's dependency prebundle avoids stale runtime classes
    // after HMR when their public APIs change.
    exclude: ["@floe-note/document", "@floe-note/storage"],
  },
  resolve: {
    alias: [
      {
        find: /^loro-crdt$/,
        replacement: "loro-crdt/base64",
      },
    ],
  },
});
