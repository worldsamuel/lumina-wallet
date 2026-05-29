# Lumina Wallet Deployment

This project deploys the Next.js Mini App to Vercel and uses Supabase Postgres through Prisma.

## Vercel Frontend

1. Sign in to Vercel with GitHub.
2. Choose **Add New > Project**.
3. Import `worldsamuel/lumina-wallet`.
4. Keep the framework preset as **Next.js**.
5. Keep the build command as `npm run build`.
6. Add the production environment variables from `.env.production.example`.
7. Deploy from the `main` branch.

Vercel will run `postinstall`, which executes `prisma generate` before the build.

## Production Environment Variables

Required in Vercel:

- `DATABASE_URL`: Supabase pooled PostgreSQL URL for runtime queries.
- `DIRECT_URL`: Supabase session/direct PostgreSQL URL for Prisma migrations.
- `NEXT_PUBLIC_WORLD_APP_ID`: public World Mini App ID.
- `WORLD_APP_SECRET`: server-only World App secret.
- `SESSION_SECRET`: JWT secret for user sessions.
- `ADMIN_SESSION_SECRET`: JWT secret for admin sessions.
- `ADMIN_INITIAL_PASSWORD`: first admin password used by the seed script.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL, if client usage is enabled.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key, if client usage is enabled.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service role key, if needed.

Do not put `WORLD_APP_SECRET`, `SESSION_SECRET`, `ADMIN_SESSION_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` in any `NEXT_PUBLIC_*` variable.

## Supabase Configuration

1. Create the Supabase project.
2. Open **Project Settings > Database**.
3. Copy the shared transaction-mode pooler URL for `DATABASE_URL`.
4. Copy the session-mode pooler URL for `DIRECT_URL`.
5. Add `sslmode=require&uselibpqcompat=true` to both URLs.
6. Use `pgbouncer=true` only on `DATABASE_URL`.

Recommended format:

```env
DATABASE_URL="postgresql://postgres.PROJECT:[PASSWORD]@REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require&uselibpqcompat=true"
DIRECT_URL="postgresql://postgres.PROJECT:[PASSWORD]@REGION.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true"
```

## Safe Database Deployment

Use production deployment commands only after the code is merged to `main` and the Vercel environment variables are configured.

1. Create `.env.production` locally from `.env.production.example`.
2. Put the production Supabase URLs and secrets into `.env.production`.
3. Confirm Prisma can read the schema:

```bash
npx prisma validate
```

4. Deploy migrations to production:

```bash
npm run db:deploy:prod
```

This runs `prisma migrate deploy`, not `prisma migrate dev`. Production should not use a shadow database or attempt to create new migrations.

5. Seed production data:

```bash
npm run db:seed:prod
```

The seed script uses upsert, so it is safe to run more than once.

6. Verify production API:

```bash
curl https://YOUR-VERCEL-DOMAIN.vercel.app/api/tokens
curl https://YOUR-VERCEL-DOMAIN.vercel.app/api/announcements
curl https://YOUR-VERCEL-DOMAIN.vercel.app/api/content/help
```

## Rollback Plan

Application rollback:

1. Open Vercel **Deployments**.
2. Select the previous healthy deployment.
3. Click **Promote to Production**.

Database rollback:

1. Prefer forward fixes: create a new Prisma migration that restores the previous compatible shape.
2. If data was damaged, restore from a Supabase backup or point-in-time recovery if available on the plan.
3. If the migration only added optional columns or tables, keep them in place and redeploy the previous app while preparing a cleanup migration.

Never run `prisma migrate dev` against production.

## World Mini App

1. Open the World Developer Portal.
2. Set the app URL to the Vercel HTTPS URL.
3. Confirm the App ID matches `NEXT_PUBLIC_WORLD_APP_ID`.
4. Keep the App Secret server-only as `WORLD_APP_SECRET`.
5. Test inside World App after Vercel deployment; normal desktop browsers should show the World App prompt.

## Domain And HTTPS

The default `.vercel.app` domain receives HTTPS automatically.

For a custom domain:

1. Add it in Vercel **Project Settings > Domains**.
2. Point DNS to Vercel.
3. Wait for certificate provisioning.
4. Update the World Developer Portal app URL to the final HTTPS domain.
