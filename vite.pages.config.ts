import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  return {
    root,
    base: "/hidden-gem-radar-v2/",
    plugins: [react()],
    resolve: { alias: { "@": root } },
    define: {
      "process.env.NEXT_PUBLIC_AMAP_JS_KEY": JSON.stringify(env.NEXT_PUBLIC_AMAP_JS_KEY ?? ""),
      "process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE": JSON.stringify(env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE ?? ""),
      "process.env.NEXT_PUBLIC_PAGES_MODE": JSON.stringify("1"),
    },
    build: { outDir: "dist-pages", emptyOutDir: true },
  };
});
