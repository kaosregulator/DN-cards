import { defineConfig } from "vite";
import path from "path";

// The DN Cards Activity runs INSIDE Discord as an iframe. Discord serves it
// behind its proxy and rewrites all traffic through `/.proxy/…`, so the client
// talks to the backend via a RELATIVE base (see src/net/api.ts). We do not bake
// an absolute API host in here.
//
// PORT is only used by `vite dev` / `vite preview`; `vite build` never needs it.
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5174;
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH affects built asset paths. The Discord proxy maps the Activity's
// root URL mapping to "/", so default to "/".
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(({ command }) => ({
  // Replit mounts the development artifact at /activity, while Discord maps
  // the production Activity host's root URL to /. Keep those contracts
  // separate so local preview modules resolve without changing Discord URLs.
  base: command === "serve" && basePath === "/" ? "/activity/" : basePath,
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Phaser is large; keep it in its own chunk so the shell loads fast and the
    // engine streams in. Scene/asset lazy-loading comes in later phases.
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    // Discord proxies the Activity through discordsays.com hosts.
    allowedHosts: true,
    // Discord's iframe requires HMR over the proxied wss connection.
    hmr: { clientPort: 443 },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
}));
