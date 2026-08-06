# Supabase

## Applying the schema

Either paste `migrations/0001_profiles.sql` into **Supabase Studio → SQL
Editor** and run it, or use the CLI:

```bash
supabase db push
```

## Auth settings this code assumes

In **Authentication → Sign In / Providers → Email**:

| Setting | Value | Why |
|---|---|---|
| Enable Email provider | on | `signInWithPassword` / `signUp` |
| Confirm email | **on** | makes `register` return `verificationRequired: true` and drives the OTP step |
| Secure email change | on | recommended |

With *Confirm email* **off**, `signUp` returns a session immediately, and the
Angular register page skips the OTP step on its own — no code change needed.

## Email templates

`templates/confirm-signup.html` and `templates/reset-password.html` are styled
on the DESIGN-mintlify.md tokens.

Every template **must render `{{ .Token }}`** — the Angular pages ask the user
to type the 6-digit code, so a template carrying only the magic link leaves the
OTP screen with nothing to enter.

| Where | How |
|---|---|
| Local (`supabase start`) | Already wired in `config.toml` under `[auth.email.template.*]` |
| Hosted project | **Authentication → Emails**, paste the file contents into *Confirm signup* and *Reset password*, and set the subject line |

Subjects used in `config.toml`, mirror them in the dashboard:

- Confirm signup → `Mã xác thực Fizzle của bạn`
- Reset password → `Đặt lại mật khẩu Fizzle`

The two files repeat the same frame on purpose: Supabase stores each template
independently and has no include mechanism, so a change to the shell has to be
applied to both.

Code lifetime in the copy ("60 phút") tracks `otp_expiry` in `config.toml` and
the matching setting on the hosted project — change one, change the other.

## Keys

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It belongs only in the
backend `.env` — never in `fizzle-fe`, and never committed.
