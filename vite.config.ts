import { defineConfig } from "vite";
import rom from "./vite-plugin-rom.ts";

// base = имя репозитория для GitHub Pages. Локально и в preview работает как есть.
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? "/",
  plugins: [rom("content")],
  server: {
    // CloudPub выдаёт случайный поддомен; без этого Vite отвечает 403.
    allowedHosts: [".cloudpub.ru"],
  },
});
