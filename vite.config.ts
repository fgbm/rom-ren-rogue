import { defineConfig } from "vite";

// base = имя репозитория для GitHub Pages. Локально и в preview работает как есть.
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? "/",
});
