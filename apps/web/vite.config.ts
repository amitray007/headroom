import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the Headroom server, or to HEADROOM_API_ORIGIN when set. The default is `mise run dev` on :4323.
const apiOrigin = process.env["HEADROOM_API_ORIGIN"] ?? "http://localhost:4323";

// `--mode demo` builds the static demo site: relative URLs so it can sit under a sub-path, and no server behind it.
export default defineConfig(({ mode }) => ({
  base: mode === "demo" ? "./" : "/",
  plugins: [react()],
  server: { proxy: { "/api": apiOrigin } },
  build: {
    outDir: mode === "demo" ? "dist-demo" : "dist",
    emptyOutDir: true,
    // Browsers with native light-dark(). An older target makes the CSS minifier rewrite light-dark() into
    // prefers-color-scheme fallbacks, which ignore the Light and Dark choice in the account menu.
    rolldownOptions: {
      output: {
        // Vendor code changes far less often than the app, so it gets its own long-cached chunks.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
            { name: "zod", test: /node_modules[\\/]zod[\\/]/ },
            {
              name: "auth",
              test: /node_modules[\\/](?:better-auth|@better-auth|better-call|@better-fetch|nanostores)[\\/]/,
            },
          ],
        },
      },
    },
    cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"],
  },
}));
