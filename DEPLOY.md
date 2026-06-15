# Deploying Thyme by Vine to Production

This guide walks through every step needed to go from a local dev environment to a live Cloudflare Pages deployment with all integrations wired up.

---

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [Google Cloud Console](https://console.cloud.google.com) project
- A [Stripe account](https://dashboard.stripe.com/register)
- A [Resend account](https://resend.com) (for transactional email)
- Node.js ≥ 18 and `wrangler` installed (`npm i -g wrangler`)

---

## 1. Cloudflare — Create a Pages Project

1. Log in to Cloudflare: `wrangler login`
2. In the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. Connect your GitHub/GitLab repo and pick the `thyme-by-vine` repository
4. Build settings:
   - **Framework preset**: None (manual)
   - **Build command**: `npm run build`
   - **Build output directory**: `build/client`
5. Click **Save and Deploy** (the first deploy will fail — that's fine, env vars and D1 come next)

---

## 2. Cloudflare D1 — Create the Database

```bash
# Create the production database
npx wrangler d1 create thyme-by-vine-db
```

Copy the `database_id` printed in the output, then open `wrangler.toml` and replace the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "thyme-by-vine-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"   # ← replace this
```

Apply all migrations to production:

```bash
npx wrangler d1 migrations apply DB --remote
```

Bind the database in the Cloudflare dashboard:
1. **Workers & Pages** → your Pages project → **Settings** → **Functions**
2. **D1 database bindings** → **Add binding**
   - Variable name: `DB`
   - D1 database: `thyme-by-vine-db`

---

## 3. Clerk — Authentication

Clerk handles all owner sign-up, sign-in, and session management.

1. Go to [clerk.com](https://clerk.com) → **Create application**
2. Choose your sign-in methods (Email + Password, Google — match what you want to offer)
3. From the **API Keys** page, copy:
   - **Publishable Key** (starts with `pk_live_…` / `pk_test_…`)
   - **Secret Key** (starts with `sk_live_…` / `sk_test_…`) — never commit this
4. In Clerk Dashboard → **Configure** → **Paths** (under "Redirects"), set:
   - Sign-in URL: `/login`
   - Sign-up URL: `/register`
   - After sign-in URL: `/onboarding`
   - After sign-up URL: `/onboarding`
5. Add keys to Cloudflare:
   - `CLERK_PUBLISHABLE_KEY` → add under `[vars]` in `wrangler.toml` (safe to commit)
   - `CLERK_SECRET_KEY` → add as a Cloudflare Pages secret (never commit):
     ```bash
     npx wrangler pages secret put CLERK_SECRET_KEY
     ```

> **Note**: `SESSION_SECRET` is no longer needed — remove it from your env vars if it was previously set.

---

## 4. Google OAuth — Client ID & Secret

These are used for **booker "Continue with Google"** (pre-fill) and **owner Google Calendar connect**.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project (or create one)
3. **APIs & Services** → **OAuth consent screen**
   - User type: **External**
   - Fill in app name, support email, developer contact
   - Add scope: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar` (for GCal integration)
   - Add any test users while in development
   - Submit for verification if going live publicly
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URIs — add **both**:
     - `http://localhost:5173/auth/google/callback` (local dev)
     - `https://YOUR_DOMAIN/auth/google/callback` (production)
5. Copy the **Client ID** and **Client Secret**

Also enable the Google Calendar API:
1. **APIs & Services** → **Library**
2. Search "Google Calendar API" → **Enable**

---

## 4. Stripe — API Keys

Stripe handles payment collection for paid bookings.

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Make sure you're in **Live mode** (toggle top-left; use Test mode for staging)
3. **Developers** → **API keys**
   - Copy **Publishable key** (starts with `pk_live_…`)
   - Copy **Secret key** (starts with `sk_live_…`) — store securely, never commit

---

## 5. Resend — Email API Key

Resend is used for booking confirmation emails.

1. Go to [resend.com](https://resend.com) → **API Keys** → **Create API Key**
2. Name it (e.g., `thyme-by-vine-prod`)
3. Permission: **Sending access**
4. Copy the key (starts with `re_…`)
5. In Resend → **Domains** → **Add Domain** — verify your sending domain with DNS records so emails don't land in spam

---

## 6. Set All Environment Variables

### In Cloudflare Dashboard

Go to **Workers & Pages** → your Pages project → **Settings** → **Environment variables** → **Production**.

Add each variable:

| Variable | Value | Notes |
|---|---|---|
| `APP_URL` | `https://YOUR_DOMAIN` | No trailing slash |
| `CLERK_PUBLISHABLE_KEY` | `pk_live_…` | Also add to `wrangler.toml` `[vars]` |
| `CLERK_SECRET_KEY` | `sk_live_…` | Mark as **Secret** |
| `GOOGLE_CLIENT_ID` | (from Step 4) | |
| `GOOGLE_CLIENT_SECRET` | (from Step 4) | Mark as **Secret** |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | |
| `STRIPE_SECRET_KEY` | `sk_live_…` | Mark as **Secret** |
| `RESEND_API_KEY` | `re_…` | Mark as **Secret** |

> Mark sensitive values as **Secret** (encrypted at rest, not visible after saving).

### In `wrangler.toml` (non-secret vars only)

Update the `[vars]` section for production values. **Never put secrets in `wrangler.toml`** — use the dashboard or `wrangler secret put` for those.

```toml
[vars]
APP_URL = "https://YOUR_DOMAIN"
CLERK_PUBLISHABLE_KEY = "pk_live_..."
STRIPE_PUBLISHABLE_KEY = "pk_live_..."
```

---

## 8. Custom Domain (Optional but Recommended)

1. In the Cloudflare dashboard → **Workers & Pages** → your project → **Custom domains**
2. Click **Set up a custom domain** → enter your domain (e.g., `app.thymebyv.com`)
3. If your domain is already on Cloudflare DNS, it will configure automatically
4. If not, add a CNAME record pointing to your Pages URL

---

## 9. Deploy

```bash
npm run build && npx wrangler pages deploy build/client
```

Or just push to your connected Git branch — Cloudflare Pages will build and deploy automatically.

---

## 10. Post-Deploy Checklist

- [ ] Visit `https://YOUR_DOMAIN` — booking page loads
- [ ] Owner can log in via `/login`
- [ ] Owner can log in with Google (OAuth redirect works)
- [ ] Booker can select slots and pay via Stripe
- [ ] Booking confirmation email arrives (Resend)
- [ ] Google Calendar event appears for owner after booking
- [ ] Past slots are disabled in the calendar
- [ ] Settings → timezone dropdown saves correctly

---

## Local Dev Reference

```bash
# Apply migrations locally
npx wrangler d1 migrations apply DB --local

# Run dev server
npm run dev

# Type check
npx tsc --noEmit
```

Local secrets go in a `.dev.vars` file (git-ignored):

```
CLERK_SECRET_KEY=sk_test_...
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
STRIPE_SECRET_KEY=sk_test_...
RESEND_API_KEY=re_...
```
