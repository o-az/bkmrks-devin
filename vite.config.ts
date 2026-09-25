import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { handleBookmarks } from "./server/x";

// Serves api/bookmarks locally with the same handler Vercel runs.
const api: Connect.NextHandleFunction = async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const request = new Request(`http://${req.headers.host}/api/bookmarks`, {
    method: req.method,
    headers,
    body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
  });
  const response = await handleBookmarks(request);
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(await response.text());
};

function apiPlugin(): Plugin {
  return {
    name: "sift-api",
    configureServer: (server) => void server.middlewares.use("/api/bookmarks", api),
    configurePreviewServer: (server) => void server.middlewares.use("/api/bookmarks", api),
  };
}

export default defineConfig({
  plugins: [
    react(),
    apiPlugin(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Sift — X bookmarks, sorted",
        short_name: "Sift",
        description: "Sort and filter your X bookmarks by engagement, date and media type.",
        theme_color: "#0d0e10",
        background_color: "#0d0e10",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
