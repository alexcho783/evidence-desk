# Evidence Desk — public edition

A medical literature search that sorts what it finds by **what kind of study each paper is**,
rather than only by relevance. Every result is placed on a grid: study-design strength down the
vertical axis, publication era across the horizontal.

Three static files, no build step, no dependencies, no server, no account, no tracking.

```
index.html    markup and icons
styles.css    design tokens and layout
app.js        retrieval, classification, rendering
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

Nothing syncs between devices, which is what the BibTeX and RIS exports are for.

Every read and write is wrapped in `try`/`catch`, so the site works in a private window or with
site data blocked.

## Attribution

Literature data from [Europe PMC](https://europepmc.org). Europe PMC asks that you acknowledge
them as the source, which the sidebar and the About page do. Check their
[terms](https://europepmc.org/About) before putting this behind any kind of paywall or heavy
automated load.

This site is not medical advice and should not be used to make decisions about anyone's care.
