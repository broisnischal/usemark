import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    resolve: {
      tsconfigPaths: true,
    },
    optimizeDeps: {
      include: [
        "use-sync-external-store/shim/with-selector",
        "use-sync-external-store/with-selector",
      ],
      exclude: ["@tanstack/react-hotkeys"],
    },
    server: {
      port: 3000,
      // Router plugin rewrites `routeTree.gen.ts`; watching that file can cause reload/HMR churn
      // and worsen intermittent SSR TDZ errors (see TanStack Router #6775, #5673).
      watch: {
        ignored: ["**/routeTree.gen.ts"],
      },
    },
    plugins: [
      devtools(),
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tanstackStart(),
      viteReact(),
      // Keep dev HMR responsive; run React Compiler only for non-dev builds.
      !isDev
        ? babel({
            presets: [reactCompilerPreset()],
          })
        : null,
      tailwindcss(),
    ],
  };
});
