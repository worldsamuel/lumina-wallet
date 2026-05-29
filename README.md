# Lumina Wallet

Lumina Wallet is a Next.js 14 World Mini App. The v22 user prototype is routed through App Router, MiniKit walletAuth identifies the World App wallet, and admin-managed configuration is stored in PostgreSQL through Prisma.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. A normal browser should show `Please open this app inside World App`. For UI-only local preview, use `http://localhost:3000/?mockWorld=1`.

## Supabase Database

1. Create the Supabase project.
2. Copy the shared transaction pooler URI to `DATABASE_URL`.
3. Copy the session pooler URI to `DIRECT_URL`.
4. Replace `[PASSWORD]` in both URLs.
5. Keep `DATABASE_URL`, `DIRECT_URL`, `WORLD_APP_SECRET`, `SESSION_SECRET`, `ADMIN_SESSION_SECRET`, and `ADMIN_INITIAL_PASSWORD` out of git.

## Prisma

Generate the client:

```bash
npx prisma generate
```

Create and apply a migration:

```bash
npx prisma migrate dev --name init_backend
```

Seed default data:

```bash
npm run db:seed
```

Deploy migrations in production:

```bash
npm run prisma:migrate
```

## Changing Database Fields

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma validate`.
3. Run `npx prisma migrate dev --name describe_change`.
4. Update seed data if defaults changed.
5. Run `npm run build`.
6. Commit the schema and generated migration folder.

## Admin Bootstrap

Set `ADMIN_INITIAL_PASSWORD` before `npm run db:seed`. The seed creates:

- username: `admin`
- password: value of `ADMIN_INITIAL_PASSWORD`

Admin login sets an httpOnly `admin_session` cookie. Write routes record `AuditLog` rows.

## Useful API Checks

```bash
curl http://localhost:3000/api/tokens
curl http://localhost:3000/api/announcements
curl http://localhost:3000/api/content/help
curl http://localhost:3000/api/currency-rates
curl http://localhost:3000/api/fees
```

## World Mini App

Configure the deployed HTTPS URL in the World Developer Portal and set:

- `NEXT_PUBLIC_WORLD_APP_ID`
- `WORLD_APP_SECRET`
- `SESSION_SECRET`
