import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-maskable-512x512.png",
      ],
      manifest: {
        name: "Floe Note",
        short_name: "Floe Note",
        description: "Local-first, peer-to-peer notes.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f6f9fa",
        theme_color: "#f6f9fa",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cacheId: "floe-note",
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}",
        ],
        navigateFallback: "index.html",
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
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
