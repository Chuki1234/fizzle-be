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

In **Authentication → Emails → Confirm signup**, the template must include the
6-digit token, not only the magic link, since the UI asks the user to type it:

```
Mã xác thực của bạn là: {{ .Token }}
```

## Keys

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It belongs only in the
backend `.env` — never in `fizzle-fe`, and never committed.
