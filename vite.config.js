import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is built into dist/ and served by server.mjs on port 5173, next to the data API. `base: "./"` keeps every
// address relative (api/..., data/..., css/...), exactly as in the original portal.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
