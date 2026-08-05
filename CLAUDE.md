<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# OpenShelf

Multi-vendor ecommerce SaaS. Nx monorepo, Express microservices, Next.js frontends.

## Commands
- Serve a service: `npx nx serve @openshelf/auth-service`
- Prisma: `npm run prisma:generate`, `npm run prisma:push`
- Never `npm install @nx/*` — use `npx nx add` (version mismatch breaks generators)

## Hard constraints
- Prisma is pinned to 6.19.0. Prisma 7 dropped MongoDB support entirely. Never upgrade.
- MongoDB via Atlas (needs a replica set). Use `db push`, not `migrate` — Mongo has no migrations.
- All projects are scoped `@openshelf/*`. Nx targets live in each app's package.json
  under an "nx" key, not project.json.

## Architecture
- apps/ = runnable services. libs/ = imported code. Services never import each other.
- Every tenant-owned document has `shopId`. Every query must filter by it.
  Forgetting this leaks one vendor's data to another — treat as a security bug.
- Redis for ephemeral (OTP, cart, rate limits). MongoDB for durable.

## Conventions
- Errors: throw AppError subclasses from @openshelf/errors, never res.status().json() inline
- Secrets in .env only. Never commit, never paste into chat.

## Git
- NEVER run `git commit`, `git push`, `git reset`, or `git checkout`.
  The user handles all commits. Stage nothing.
- `git status`, `git diff`, and `git log` are fine — read-only inspection only.

## Running services
- Do not leave `nx serve` running after verifying a change — stop it (Ctrl+C)
  before ending the task. Orphaned processes cause EADDRINUSE on the next run.
- Ports: gateway 8080, auth 6001, product 6002, seller 6003, order 6004,
  notification 6005, recommender 6006. Frontends: user-ui 3000, seller-ui 3001,
  admin-ui 3002.