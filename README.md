# OpenShelf

A multi-vendor e-commerce marketplace built as a distributed system — independent sellers run their own storefronts under one roof, with a single checkout that splits payment across whichever vendors a buyer's cart touches.

Built as an Nx monorepo of Express microservices behind an API gateway, with Next.js frontends and a MongoDB + Redis data layer.

> **Status:** in development. Auth, seller onboarding, shop creation, and the API gateway are implemented. See [Roadmap](#roadmap) for what's next.

---

## Architecture

```
                         Cloudflare
                             │
                      ┌──────▼──────┐
                      │ api-gateway │  :8080   CORS · rate limiting · routing
                      └──────┬──────┘
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  ┌─────▼─────┐      ┌───────▼──────┐     ┌───────▼──────┐
  │   auth    │:6001 │    seller    │:6003│    admin     │:6007
  └─────┬─────┘      └───────┬──────┘     └───────┬──────┘
        └────────────────────┼────────────────────┘
                             │
              ┌──────────────┴──────────────┐
        ┌─────▼─────┐                 ┌─────▼─────┐
        │  MongoDB  │                 │   Redis   │
        │  (Atlas)  │                 │ (Upstash) │
        └───────────┘                 └───────────┘
```

The gateway is the only publicly reachable service. Everything behind it is private — services never speak to a browser directly, which is why CORS lives at the gateway and nowhere else.

**Data is split by lifetime, not performance.** MongoDB holds anything durable: users, sellers, shops, products, orders. Redis holds anything ephemeral: OTP codes, rate-limit counters, refresh-token registries, and later cart state and recommendation embeddings.

---

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | Nx |
| Backend | Express 5, TypeScript |
| Frontend | Next.js (App Router), Tailwind v4 |
| Primary DB | MongoDB Atlas via Prisma |
| Cache / ephemeral | Redis (Upstash) |
| Validation | Zod, shared between client and server |
| Auth | JWT in httpOnly cookies, bcrypt |

**Planned:** Kafka event bus, Stripe Connect split payments, ImageKit media pipeline, Socket.IO real-time, Firebase push, MongoDB Atlas Search, TensorFlow recommendations, Docker, GitHub Actions, AWS ECS.

---

## Getting started

### Prerequisites

- Node.js 20+
- A MongoDB Atlas cluster (a replica set is required — a local `mongod` will not work)
- An Upstash Redis database

### Setup

```bash
git clone https://github.com/Kaishhhh/OpenShelf.com.git
cd OpenShelf.com
npm install
```

Copy `.env.example` to `.env` and fill in:

```
DATABASE_URL="mongodb+srv://..."
REDIS_URL="rediss://..."
ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Generate the token secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Push the schema and seed an admin:

```bash
npm run prisma:generate
npm run prisma:push
npm run seed:admin
```

### Running

```bash
npm run dev
```

Starts the gateway, auth-service, seller-service, admin-service, and user-ui together.

| Service | Port |
|---|---|
| api-gateway | 8080 |
| auth-service | 6001 |
| seller-service | 6003 |
| admin-service | 6007 |
| user-ui | 3000 |

All browser traffic goes through `http://localhost:8080`. `requests.http` at the repo root contains a working request for every endpoint — install the VS Code REST Client extension and click through it.

---

## Design decisions

The parts of this that were non-obvious, and why they're built the way they are.

### Registration creates nothing until the OTP is verified

The pending signup — name, email, bcrypt hash — lives in Redis with a 300-second TTL. The `User` row is only written after the code is confirmed.

The alternative (create with `emailVerified: false`) lets anyone register an email they don't own, never verify, and permanently squat it — the unique constraint then blocks the real owner. Holding it in Redis means abandoned signups expire on their own, and every row in the database is a real user.

### Failure states are indistinguishable from the outside

Registering an email that already exists returns byte-identical bytes to a fresh registration — same status, same body, same `Content-Length` — with no OTP sent and nothing written to Redis. Logging in with a wrong password returns exactly what an unknown email returns.

Any difference between these is an oracle for enumerating the platform's user list. It costs real usability — you can't tell a user "that email is already registered" — and that's the trade.

### Refresh tokens rotate, and reuse revokes everything

Each refresh token carries a `jti` tracked in Redis. Using one deletes its key and issues a new token. If a token is presented whose `jti` is already gone, two parties hold it — so every session for that user is revoked and they re-authenticate.

The alternative is a stolen refresh token working undetected for its full seven days.

### Users, sellers, and admins are separate models with separate middleware

Not one `User` table with a `role` column. Each has its own Prisma model, its own Redis namespace (`otp:user:*` vs `otp:seller:*`), and its own middleware — verified by confirming a user token is rejected by the seller and admin guards.

Admins can approve shops and will eventually touch payouts. If admin were a flag on `User`, a bug that let `role` through from a request body would escalate a shopper to platform control. Separate models make that class of bug impossible rather than merely absent.

### The gateway mounts no body parser

`express.json()` upstream of a proxy route drains the request stream before the proxy forwards it — the upstream service receives an empty body and returns a validation error that looks like broken validation. The gateway doesn't parse bodies because nothing there needs to.

### Prisma is pinned to 6.x

Prisma 7 removed MongoDB support entirely; no adapter exists. This is not a version preference, it's a hard constraint.

---

## Project structure

```
apps/
  api-gateway/       single public entrypoint
  auth-service/      shopper auth
  seller-service/    seller auth, shop management
  admin-service/     admin auth, shop moderation
  user-ui/           storefront
libs/
  prisma/            schema and client singleton
  shared/auth/       OTP, tokens, hashing, lockouts — no Prisma dependency
  shared/errors/     AppError hierarchy and error middleware
  shared/middleware/ isAuthenticated, isSellerAuthenticated, requireApprovedShop
  shared/types/      zod schemas shared by both ends
  shared/redis/      ioredis client
  ui/                shared React primitives
```

`libs/shared/auth` deliberately has no Prisma dependency — it handles the generic mechanics (OTP lifecycle, token signing, lockout counters) and takes a namespace parameter, so all three auth flows share one implementation of the security-critical code while their controllers stay separate.

---

## Multi-tenancy

Every vendor-owned document carries a `shopId`, and every query filters by it. One missed filter leaks one seller's data to another, so the filtering is centralised rather than left to each query site.

`requireApprovedShop` gates seller actions: a shop must exist and be approved by an admin before it can do anything.

---

## Roadmap

- [x] Shopper auth — register, OTP verify, login, refresh rotation, logout
- [x] Seller auth and shop creation
- [x] Admin auth and shop approval
- [x] API gateway with CORS and tiered rate limiting
- [ ] Product CRUD with ImageKit uploads
- [ ] Storefront catalogue and product pages
- [ ] Atlas Search — fuzzy matching, facets, autocomplete
- [ ] Cart and Stripe Connect split-payment checkout
- [ ] Kafka event bus
- [ ] Socket.IO chat and Firebase push
- [ ] Recommendations — rules, then collaborative filtering, then TensorFlow
- [ ] Docker, GitHub Actions, AWS ECS deployment

---

## License

MIT