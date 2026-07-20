/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Odds Value Dashboard",
        short_name: "Odds Dashboard",
        lang: "zh-Hant",
        start_url: "/#/dashboard",
        scope: "/",
        display: "standalone",
        theme_color: "#11182B",
        background_color: "#11182B",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,woff,woff2,png,svg,ico,webmanifest}"],
        globIgnores: [
          "**/*.json",
          "**/hkjc-odds.json",
          "**/manifest.webmanifest",
          "**/icons/icon-192.png",
          "**/icons/icon-512.png",
          "**/icons/icon-maskable-512.png",
          "**/data/**",
          "**/archives/**",
          "**/team-logos/**",
          "**/*result*",
        ],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
