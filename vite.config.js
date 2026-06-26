import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Meeting Master web app on :5273, API on :8899.
// /api/* is proxied to the API so the frontend uses same-origin relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5273,
    // Allow access via the public tunnel host (cloudflared / ngrok) so the
    // LINE in-app browser can reach the dev server.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8899",
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the built bundle (one JS file) — far fewer requests
  // than dev mode, so it's reliable through a flaky quick-tunnel + LINE's
  // in-app browser. Same port + /api proxy so the tunnel URL is unchanged.
  preview: {
    host: true,
    port: 5273,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8899",
        changeOrigin: true,
      },
    },
  },
});
