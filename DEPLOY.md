# Lumina Wallet Deployment

This repository uses `prototype-v22.html` as the production frontend and `admin-v7.html` as the production admin console.

## Project Structure

- `/` redirects to `/final/prototype-v22.html`
- `/admin` redirects to `/final/admin-v7.html`
- `public/final/prototype-v22.html` is the official v22 frontend
- `public/final/admin-v7.html` is the official admin v7 backend UI
- `prisma/schema.prisma` defines the PostgreSQL schema for Supabase
- `app/api/*` contains World Mini App auth, verify, and payment endpoints

## Supabase

1. Create a new Supabase project.
2. Open **Project Settings > Database** and copy:
   - pooled connection string for `DATABASE_URL`
   - direct connection string for `DIRECT_URL`
3. Open **Project Settings > API** and copy:
   - Project URL for `NEXT_PUBLIC_SUPABASE_URL`
   - anon public key for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service role key for `SUPABASE_SERVICE_ROLE_KEY`
4. Add the environment variables in `.env.local` locally and in Vercel.
5. Run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

## Vercel

1. Import `https://github.com/worldsamuel/lumina-wallet` into Vercel.
2. Framework preset: **Next.js**.
3. Build command: `npm run build`.
4. Install command: `npm install`.
5. Output directory: leave default.
6. Add all environment variables listed below.
7. Deploy from the `main` branch.

## Environment Variables

Required:

- `APP_ID`: World Mini App ID, starts with `app_`.
- `DEV_PORTAL_API_KEY`: World Developer Portal API key for MiniKit transaction verification.
- `WLD_CLIENT_ID`: World ID OAuth client ID.
- `WLD_CLIENT_SECRET`: World ID OAuth client secret.
- `NEXTAUTH_URL`: production HTTPS URL, for example `https://your-domain.com`.
- `NEXTAUTH_SECRET`: strong random secret for NextAuth.
- `DATABASE_URL`: Supabase pooled PostgreSQL URL.
- `DIRECT_URL`: Supabase direct PostgreSQL URL.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key. Keep server-only.

## World Mini App

1. Open the World Developer Portal.
2. Create or select the Lumina app.
3. Set the app URL to the Vercel production HTTPS URL.
4. Configure Sign in with World ID:
   - Redirect URL: `https://your-domain.com/api/auth/callback/worldcoin`
   - Client ID: `WLD_CLIENT_ID`
   - Client secret: `WLD_CLIENT_SECRET`
5. Configure Incognito Actions used by `/api/verify`.
6. Configure MiniKit payments if payment flows are enabled.

## Domain

1. Add the production domain in Vercel under **Project Settings > Domains**.
2. Point DNS to Vercel:
   - Apex: Vercel A record or nameservers
   - `www`: CNAME to Vercel
3. Set `NEXTAUTH_URL` to the final canonical HTTPS domain.
4. Update the World Developer Portal app URL and redirect URL to the same domain.

## HTTPS

Vercel issues and renews HTTPS certificates automatically after DNS is configured. Confirm that:

- `https://your-domain.com` opens the v22 frontend.
- `https://your-domain.com/admin` opens admin v7.
- World Developer Portal URLs use HTTPS.
- No secrets are exposed as `NEXT_PUBLIC_*` except the Supabase anon key and URL.
