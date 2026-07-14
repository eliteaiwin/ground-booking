import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig(({ command }) => ({
  // Capacitor/iOS loads the built files from a local file:// URL, so assets
  // must use relative paths. For dev we keep the default '/'.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}))

