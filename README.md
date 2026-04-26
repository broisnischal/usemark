# [TanStarter](https://github.com/mugnavo/tanstarter)

<!-- scaffold:description -->

A minimal starter template for 🏝️ TanStack Start. [→ Preview here](https://tanstarter.mugnavo.com/)

```bash
bun create mugnavo
```

- [React 19](https://react.dev) + [React Compiler](https://react.dev/learn/react-compiler)
- TanStack [Start](https://tanstack.com/start/latest) + [Router](https://tanstack.com/router/latest) + [Query](https://tanstack.com/query/latest)
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) + [Base UI](https://base-ui.com/) (base-luma, [`--preset b1aIaoaxs`](https://ui.shadcn.com/create?preset=b1aIaoaxs&base=base&template=start))
- [Vite 8](https://vite.dev) + [Cloudflare Workers](https://workers.cloudflare.com/) ([TanStack hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting#cloudflare-workers--official-partner))
- [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL
- [Better Auth](https://www.better-auth.com/)
- [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)

> [!TIP]
> This template is also available as a monorepo, powered by [Vite+](https://viteplus.dev/) and pnpm. See [mugnavo/tanstarter-plus](https://github.com/mugnavo/tanstarter-plus).

## Getting Started

1. [Use this template](https://github.com/new?template_name=tanstarter&template_owner=mugnavo) or create a project using our CLI:

   ```bash
   bun create mugnavo
   ```

2. Create a `.env` file based on [`.env.example`](./.env.example).

3. Generate the initial migration with drizzle-kit, then apply to your database:

   ```sh
   bun run db generate
   bun run db migrate
   ```

   https://orm.drizzle.team/docs/migrations

4. Run the development server:

   ```bash
   bun run dev
   ```

   The development server should now be running at [http://localhost:3000](http://localhost:3000).

## Deploying to production

[![Netlify Status](https://api.netlify.com/api/v1/badges/66acdee6-8e42-436f-9943-a67cad998f63/deploy-status)](https://app.netlify.com/projects/mugnavo-tanstarter/deploys)

The [Vite config](./vite.config.ts) uses the Cloudflare plugin for Workers deployment; see [TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) for other targets.

Refer to the [TanStack Start hosting docs](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) for more information.

## Issue watchlist

- [Router/Start issues](https://github.com/TanStack/router/issues) - TanStack Start is in RC.
- [Devtools releases](https://github.com/TanStack/devtools/releases) - TanStack Devtools is in alpha and may still have breaking changes.
- [Nitro v3 beta](https://nitro.build/blog/v3-beta) - Nitro remains a dev dependency for other presets; this repo targets Cloudflare Workers in `vite.config.ts`.

## Goodies

#### Git hooks

We use [Husky](https://typicode.github.io/husky/) to run git hooks with the following tools:

- [lint-staged](https://github.com/lint-staged/lint-staged) - Run Oxfmt to format staged files on commit (`pre-commit`).

#### Scripts

We use **Bun** as the package manager and script runner (`bun install`, `bun run <script>`).

- **`auth:generate`** - Regenerate the [auth db schema](./src/lib/db/schema/auth.schema.ts) if you've made changes to your Better Auth [config](./src/lib/auth/auth.ts).
- **`db`** - Run [drizzle-kit](https://orm.drizzle.team/docs/kit-overview) commands. (e.g. `bun run db generate`, `bun run db studio`)
- **`ui`** - The shadcn/ui CLI. (e.g. `bun run ui add button`)
- **`format`**, **`lint`** - Run Oxfmt and Oxlint, or both via `bun run check`.
- **`deps`** - Selectively upgrade dependencies via taze.

#### Utilities

- [`auth/middleware.ts`](./src/lib/auth/middleware.ts) - Sample middleware for enforcing authentication on server functions & API routes.
- [`theme-toggle.tsx`](./src/components/theme-toggle.tsx), [`theme-provider.tsx`](./src/components/theme-provider.tsx) - A theme toggle and provider for toggling between light and dark mode.

## License

Code in this template is public domain via [Unlicense](./LICENSE). Feel free to remove or replace for your own project.

## Ecosystem

- [@tanstack/intent](https://tanstack.com/intent/latest/docs/getting-started/quick-start-consumers) - Up-to-date skills for your AI agents, auto-synchronized from your installed dependencies.
- [awesome-tanstack-start](https://github.com/Balastrong/awesome-tanstack-start) - A curated list of awesome resources for TanStack Start.
- [shadcn/ui Directory](https://ui.shadcn.com/docs/directory), [MCP](https://ui.shadcn.com/docs/mcp), [shoogle.dev](https://shoogle.dev/) - Component directories & registries for shadcn/ui.

 not not like that, if the live folder is rss, it should ask user for the rss, field as the input and using that it should create the live synced bookmkar that syncs time to time, and alerts if there is new changes like add the notification like count if there is any which user has not seen, 

and that can user add multiples, 

and there some of the folders that i can create or someone can share as the public, which others can use like they, like the daily dev, i want the articles/links to show up in their 