# Evidence Desk — public edition

A medical literature search that sorts what it finds by **what kind of study each paper is**,
rather than only by relevance. Every result is placed on a grid: study-design strength down the
vertical axis, publication era across the horizontal.

Static files, no build step, no framework, no tracking. Accounts are optional and off by
default; left alone, the site has no backend at all.

```
index.html           markup and icons
styles.css           design tokens and layout
app.js               retrieval, classification, rendering
config.js            account sync settings — blank by default, which disables accounts
auth.js              Supabase wrapper; loads nothing unless config.js is filled in
supabase-setup.sql   table, row-level security and account deletion
```

## Run it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly with `file://` also works, but a
local server is closer to how it will behave when deployed.

## Deploy

It is a static site, so anything that serves files will host it.

**GitHub Pages** — free, and gives you a `github.io` address:

```bash
git init && git add -A && git commit -m "Evidence Desk"
```

```bash
gh repo create evidence-desk --public --source=. --push
```

Then in the repository, **Settings → Pages → Source: Deploy from a branch → main / (root)**.
It appears at `https://<your-username>.github.io/evidence-desk/` within a minute or two.

**Netlify or Cloudflare Pages** — drag the folder onto their dashboard. No build command, no
publish directory to set.

Nothing in the code assumes it is served from the root of a domain, so a subpath works fine.

## How the data flows

Literature comes from the [Europe PMC](https://europepmc.org) REST API, called straight from the
visitor's browser. Europe PMC sends `access-control-allow-origin: *`, which is why no proxy or
API key is needed. There is no backend of any kind.

Three Europe PMC query fields are used for filtering, appended to whatever the visitor types:

| Filter | Query fragment |
| --- | --- |
| Design | `(PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Clinical Trial")` |
| Open access | `(OPEN_ACCESS:y)` |
| Year range | `(PUB_YEAR:[2015 TO 2026])` |

Europe PMC's own field syntax (`AUTH:`, `JOURNAL:`, `TITLE:`) passes straight through, so it works
in the search box too.

## How classification works

Study design is read from the publication types Europe PMC carries over from MEDLINE —
`Randomized Controlled Trial`, `Meta-Analysis`, `Practice Guideline`, `Observational Study`,
`Case Reports`. These are assigned by human indexers and are reliable.

Records with no such tag — recent entries, preprints, some non-MEDLINE journals — fall back to
reading the title and abstract for the usual signals. Those are labelled **inferred** in the
interface so a reader knows not to trust them the same way, and a record that matches nothing is
labelled *Design unclear* rather than guessed at.

The logic is `classify()` in `app.js`, about forty lines. The tier list is the `TIERS` array
directly above it; adding a row or changing the order is a one-line edit.

## What it deliberately does not do

**There is no AI anywhere in this site**, which is a design decision rather than an omission. A
static site cannot hold an API key — anything in the JavaScript is readable by every visitor — so
synthesis would mean one of:

1. A serverless function (Netlify Functions, Cloudflare Workers) holding the key, with rate
   limiting. Every stranger's search then bills to your account.
2. Asking visitors for their own API key. Don't; training people to paste keys into websites is a
   bad habit to spread.

If you add option 1 later, the natural shape is a `/api/appraise` endpoint taking the retrieved
abstracts and returning the same `{verdict, certainty, papers[]}` structure the private Claude
artifact version uses, so the rendering layer barely changes.

It also does not score quality within a tier, does not know whether a paper supports or
contradicts the question, and is not a systematic-review tool. The in-app **How it ranks** page
states all of this to visitors.

## Storage

Two kinds of state, with deliberately different lifetimes:

| What | Where | Key | Lifetime |
| --- | --- | --- | --- |
| Reading list and notes | `localStorage` | `ed-reading-list` | Until cleared |
| Theme choice | `localStorage` | `ed-theme` | Until cleared |
| Recent searches | `sessionStorage` | `ed-recent` | Until the browser closes |

Search history is session-scoped on purpose. A reading list is something you chose to keep; your
search history is not, and on a shared computer it should not be sitting there for whoever opens
the browser next. There is also a **Clear** control beside the list in the sidebar. `loadList()`
removes any `ed-recent` left in `localStorage` by earlier versions, so history that leaked under
the old behaviour is cleaned up the first time someone loads the new build.

With accounts switched off nothing syncs between devices, which is what the BibTeX and RIS
exports are for.

## Optional: accounts

Off by default. Switching them on lets people sign in and keep their reading list across
devices; everyone else carries on exactly as before, and the sign-in option simply isn't shown.

**1. Create a Supabase project** at [supabase.com](https://supabase.com) — the free tier is
enough. Pick a region near your users.

**2. Run the SQL.** Open SQL Editor → New query, paste all of `supabase-setup.sql`, Run. This
creates the table, switches on row-level security, and adds the account-deletion function. The
commented-out checks at the bottom confirm it worked.

**3. Fill in `config.js`** with the Project URL and the **anon** key from Settings → API.

The anon key is designed to be public and belongs in client code — committing it is fine. It
grants nothing on its own; row-level security is what keeps one person's rows away from
everyone else. Never put the `service_role` key here: it bypasses those policies entirely.

**4. Set the redirect URL.** In Authentication → URL Configuration, set Site URL to where the
site is actually served (for example `https://yourname.github.io/evidence-desk/`) and add it
under Redirect URLs. Sign-in links bounce off this, so a wrong value here is the usual reason
a link lands on a blank page.

**5. Email sending is the part that bites.** Supabase's built-in email service is rate-limited
to a handful of messages per hour and is meant for development. For anything public, either
set up custom SMTP (Authentication → Emails; [Resend](https://resend.com) has a free tier), or
enable Google sign-in instead and set `enableGoogle: true`, which avoids sending email
altogether.

**6. Set `contactEmail`** so the privacy page can tell people who holds their data.

## Optional: AI synthesis

Also off by default, and layered on top of accounts — signed-out visitors never trigger it. When
on, each search additionally asks a model what the retrieved abstracts say about the question,
and renders a short verdict above the results.

**What it deliberately does not do:** classify study design. That comes from MEDLINE publication
types, assigned by human indexers, and is more reliable than anything a model would infer. The
model only adds what metadata cannot give you — which way a paper points, and a synthesis across
them. A bad model answer therefore cannot move a paper into the wrong row.

**1. Get a Gemini API key** at [aistudio.google.com](https://aistudio.google.com/apikey). Free,
no card. `gemini-3.6-flash` is free-tier eligible.

**2. Deploy the Edge Function.** In the Supabase dashboard → Edge Functions → Deploy a new
function, name it `appraise`, and paste in `supabase/functions/appraise/index.ts`. No CLI needed.

**3. Add the secret.** Edge Functions → Secrets → add `GEMINI_API_KEY`.

The function enforces the limits that bound cost and abuse — at most 20 papers, 1,200 characters
of abstract each, a 300-character question — server-side, because the browser can lie about all
three. It requires a valid session, so only signed-in people can spend the quota.

If you later need to change model, `MODEL` is one constant at the top of the function.

### Google's free tier trains on your data

This is the part to be deliberate about. Google uses free-tier API data to improve its products;
paid-tier data is excluded. The site's privacy page says so plainly and tells people to treat the
search box as public while signed in. Abstracts are already public literature, but the *question*
is the user's own, so this matters.

If that trade stops being acceptable — more users, or more sensitive questions — the fix is a
paid key rather than a rewrite: Gemini's paid tier excludes your data, and swapping to a different
provider means editing one function, not the site.

### If you switch accounts on, you take on data protection duties

Storing other people's email addresses and reading lists makes you a data controller under UK
GDPR. The site ships with what that mostly requires: a privacy page saying exactly what is
stored and why, and a delete button that removes the account and its rows for good. What it
cannot do for you is be truthful on your behalf — keep the privacy page accurate if you change
what is stored, and put a real address in `contactEmail`.

Two deliberate choices worth keeping if you edit this:

- **Signing out wipes the local copy**, so a shared computer is not left showing one person's
  list to the next. The exception is a list that never finished syncing, which is kept, because
  deleting it would destroy the only copy.
- **Deletion is real deletion.** `delete_my_account()` removes the rows and the auth user in one
  transaction. There is no soft-delete and no recovery.

Every read and write is wrapped in `try`/`catch`, so the site works in a private window or with
site data blocked.

## Attribution

Literature data from [Europe PMC](https://europepmc.org). Europe PMC asks that you acknowledge
them as the source, which the sidebar and the About page do. Check their
[terms](https://europepmc.org/About) before putting this behind any kind of paywall or heavy
automated load.

This site is not medical advice and should not be used to make decisions about anyone's care.
