/* Evidence Desk — weekly saved-search alerts (N11).
 *
 * Runs once a week, called by pg_cron. For each saved search that is not paused, it reruns
 * the query against Europe PMC restricted to records first indexed since the last run, and
 * emails anything new that is a synthesis or a trial.
 *
 * NOT DEPLOYED. See README, "Saved search alerts", for the exact commands.
 *
 * Four things this function is careful about.
 *
 *  1. It holds the service role key, which bypasses row-level security entirely. That is
 *     why it runs here and not in the browser, and why it never echoes a query or an email
 *     address back in a response: the response goes to a cron job, not to a person.
 *  2. It is not a public endpoint. pg_cron sends a shared secret; without it the function
 *     answers 401 and does nothing, so a stranger cannot make it send mail.
 *  3. It only ever sends to the address attached to the account that saved the search.
 *  4. Nothing is logged. Not the query, not the address, not the results. A log of what
 *     people are searching for is the one thing this site has always refused to keep.
 */

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY")!;
const MAIL_FROM    = Deno.env.get("ALERT_FROM") ?? "Evidence Desk <alerts@example.com>";
const SITE_URL     = Deno.env.get("SITE_URL") ?? "https://example.github.io/evidence-desk/";
const CRON_SECRET  = Deno.env.get("CRON_SECRET")!;

/* Only the two rows worth interrupting someone for. A weekly email about every new
   narrative review would be noise, and noise gets a rule set up to delete it. */
const WORTH_IT =
  '(PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Practice Guideline"' +
  ' OR PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Clinical Trial")';

type Saved = {
  id: string; user_id: string; query: string;
  last_run: string | null; last_seen: string[];
};

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function newSince(query: string, since: string | null) {
  /* FIRST_IDATE is when Europe PMC indexed the record, which is what "new to this search"
     means. Publication year would resurface old papers every time the index catches up. */
  const from = (since ?? new Date(Date.now() - 7 * 864e5).toISOString()).slice(0, 10);
  const q = `(${query}) AND ${WORTH_IT} AND (FIRST_IDATE:[${from} TO 3000-01-01])`;
  const p = new URLSearchParams({
    query: q, format: "json", resultType: "lite", pageSize: "10", sort: "P_PDATE_D desc"
  });
  const r = await fetch(`${EPMC}?${p}`, { headers: { Accept: "application/json" } });
  if (!r.ok) return [];
  const d = await r.json();
  return (d?.resultList?.result ?? []) as Array<Record<string, string>>;
}

async function emailFor(userId: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.email ?? null;
}

function body(query: string, rows: Array<Record<string, string>>) {
  const items = rows.map(x => `
    <li style="margin:0 0 14px">
      <a href="https://europepmc.org/article/${x.source}/${x.id}"
         style="color:#1F4E9C;text-decoration:none;font-weight:600">${esc(x.title ?? "Untitled")}</a><br>
      <span style="color:#5A6472;font-size:13px">${esc(x.journalTitle ?? "")} ${esc(x.pubYear ?? "")}</span>
    </li>`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px">
    <p style="color:#5A6472;font-size:13px;margin:0 0 4px">Evidence Desk</p>
    <h2 style="margin:0 0 4px;font-size:18px">${rows.length} new ${rows.length === 1 ? "paper" : "papers"}</h2>
    <p style="color:#5A6472;font-size:13px;margin:0 0 18px">for <b>${esc(query)}</b>, syntheses and trials only</p>
    <ul style="padding-left:18px;margin:0">${items}</ul>
    <p style="margin:22px 0 0;font-size:13px">
      <a href="${SITE_URL}?q=${encodeURIComponent(query)}" style="color:#1F4E9C">Open this search</a> ·
      <a href="${SITE_URL}?v=list" style="color:#1F4E9C">Manage your alerts</a>
    </p>
    <p style="color:#78828F;font-size:12px;margin:14px 0 0">
      You are getting this because you saved this search on Evidence Desk. Pause or delete it
      from Manage your alerts; deleting your account removes it too.</p>
  </div>`;
}

Deno.serve(async req => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("no", { status: 401 });
  }

  const due = await rest("saved_searches?paused=eq.false&select=id,user_id,query,last_run,last_seen");
  if (!due.ok) return new Response("db", { status: 500 });
  const rows: Saved[] = await due.json();

  let sent = 0;
  for (const s of rows) {
    try {
      const hits = await newSince(s.query, s.last_run);
      const seen = new Set(s.last_seen ?? []);
      const fresh = hits.filter(h => !seen.has(`${h.source}:${h.id}`));
      const now = new Date().toISOString();

      if (fresh.length) {
        const to = await emailFor(s.user_id);
        if (to) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: MAIL_FROM, to,
              subject: `${fresh.length} new ${fresh.length === 1 ? "paper" : "papers"}: ${s.query.slice(0, 60)}`,
              html: body(s.query, fresh)
            })
          });
          sent++;
        }
      }

      /* last_seen is capped, or a popular search grows this row without limit. */
      const keep = [...fresh.map(h => `${h.source}:${h.id}`), ...(s.last_seen ?? [])].slice(0, 200);
      await rest(`saved_searches?id=eq.${s.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_run: now, last_seen: keep })
      });
    } catch (_e) {
      /* One broken search must not stop the rest, and the reason is not logged. */
    }
  }

  /* A count, and nothing identifying. */
  return new Response(JSON.stringify({ checked: rows.length, sent }), {
    headers: { "Content-Type": "application/json" }
  });
});
