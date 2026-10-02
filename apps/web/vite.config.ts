import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the Headroom server, or to HEADROOM_API_ORIGIN when set. The default is the local instance on :18600.
const apiOrigin = process.env["HEADROOM_API_ORIGIN"] ?? "http://localhost:18600";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": apiOrigin } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Browsers with native light-dark(). An older target makes the CSS minifier rewrite light-dark() into
    // prefers-color-scheme fallbacks, which ignore the Light and Dark choice in the account menu.
    cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"],
  },
});
