# Discover — one-time backend setup (~10 minutes, Supabase only)

You do this **once**, as the owner. Your app's users never see any of this — they just
register with email + password inside PromptPad. All the code is already written; this guide
only creates one free Supabase project and pastes 2 values into the app.

For this first version, **everything lives in Supabase** (free, no credit card):
accounts + database + image storage (1 GB). When uploads start filling that 1 GB, we'll move
image storage to a bigger/cheaper provider (e.g. **runflare** or Cloudflare R2) — the app is
built so only image storage swaps out; accounts and data stay in Supabase.

---

## Part A — Create the Supabase project

1. Go to **https://supabase.com** → sign up (free) → **New project**. Pick a name and a strong
   database password, choose the region nearest you, and wait ~2 minutes for it to provision.
2. Left sidebar → **SQL Editor** → **New query**. Open `schema.sql` (in this folder), copy
   **all** of it, paste, and click **Run**. You should see "Success". (This creates the tables,
   security rules, and the `discover-images` storage bucket.)
3. Left sidebar → **Project Settings** (gear) → **API**. Copy these two values:
   - **Project URL** → your `SUPABASE_URL`
   - **Project API keys → `anon` `public`** → your `SUPABASE_ANON_KEY`
4. *(Optional, makes testing easier)* **Authentication → Providers → Email** → turn
   **"Confirm email"** OFF so new accounts work instantly without a confirmation email. Turn it
   back ON for a real public launch.

---

## Part B — Plug the values into the app

Open **`src/discover-config.js`** and fill in the two values:

```js
window.DISCOVER_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGci...your anon key...',
  IMAGE_BUCKET: 'discover-images'
};
```

Restart PromptPad. The **Discover** tab is now live. (The app already allows `*.supabase.co`
in its security policy.)

---

## Part C — Make yourself the admin

1. In PromptPad, open **Discover** and **register** with your email + password.
2. Back in Supabase → **SQL Editor**, run this once (use the email you just registered):
   ```sql
   update public.profiles set is_admin = true
     where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Reopen Discover — you now have the **Admin** panel (moderate posts, manage categories, see
   the storage-usage meter).

---

## Part D — Shared notes (live collaboration)

Nothing extra to install: the tables, policies and functions for shared notes are at the
bottom of the same `schema.sql`. If you set Discover up **before** this feature existed,
just re-run the whole file once (it's idempotent) and shared notes start working.

Two things worth knowing:

- **Realtime must be on** for the project (it is, by default). The last block of `schema.sql`
  adds `shared_notes`, `note_members` and `note_invites` to the `supabase_realtime`
  publication — that's what delivers invitations and live edits.
- **The `shared_notes` row is the source of truth.** Clients write with a compare-and-swap on
  its `rev` column and rebase their own text onto whatever was accepted, so two people typing
  at once converge instead of overwriting each other.

Users invite each other by **username** (the one they picked at registration), so tell people
to choose a username they're happy to share.

---

### Notes
- `SUPABASE_ANON_KEY` is a **public** key — meant to ship in client apps. The Row-Level
  Security installed by `schema.sql` is what actually protects the data.
- Images are stored in the public `discover-images` bucket; users can only write/delete inside
  their own folder (enforced by storage policies), and admins can delete anything.

**Later — the "volume" phase:** when 1 GB isn't enough, we'll point image uploads at runflare
(or R2) object storage and keep Supabase for accounts + data. Tell me when you want to do that
and I'll wire it up.

When you've done Parts A–B, tell me and I'll build & test the in-app Discover screens against
your live backend.
