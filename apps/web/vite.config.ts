import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^loro-crdt$/,
        replacement: "loro-crdt/base64",
      },
    ],
  },
});
