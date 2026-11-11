/* Evidence Desk — optional account sync.
 *
 * Wraps Supabase auth and one table. Loads nothing and does nothing unless config.js
 * carries a project URL and anon key, so the account-free build stays exactly as it was:
 * no third-party script, no requests, no cookies.
 *
 * Isolation between people is enforced by row-level security in the database, not here
 * (see supabase-setup.sql). Treat every function below as a convenience over that policy
 * rather than as the thing that keeps data apart.
 */
(() => {
"use strict";

const CFG = window.ED_CONFIG || {};
const enabled = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
/* 2.118.0 or later: earlier releases predate Supabase's sb_publishable_ key format. */
const SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js";

let client = null;
let session = null;
const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(); } catch(e){} } };

function loadScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("blocked"));
    document.head.appendChild(s);
  });
}

/* Plain-English messages. Supabase's own strings are terse and sometimes misleading
   for someone who is simply trying to sign in. */
function friendly(err){
  const m = String((err && err.message) || err || "").toLowerCase();
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many sign-in emails for now. Wait a few minutes and try again.";
  if (m.includes("invalid") && m.includes("email"))
    return "That doesn't look like a valid email address.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Couldn't reach the sign-in service. Check your connection and try again.";
  if (m.includes("provider") && m.includes("not enabled"))
    return "That sign-in method isn't switched on for this site.";
  if (m.includes("row-level security") || m.includes("permission") || m.includes("denied"))
    return "The server refused that change. You may have been signed out — try signing in again.";
  if (m.includes("jwt") || m.includes("expired"))
    return "Your session expired. Sign in again to keep syncing.";
  return "Something went wrong talking to the sync service.";
}

const ready = (async () => {
  if (!enabled) return false;
  try {
    await loadScript(SRC);
    const lib = window.supabase;
    if (!lib || typeof lib.createClient !== "function") throw new Error("library missing");
    client = lib.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await client.auth.getSession();
    session = (data && data.session) || null;
    client.auth.onAuthStateChange((_evt, s) => { session = s || null; emit(); });
    return true;
  } catch (e) {
    client = null;
    return false;
  }
})();

function requireSession(){
  if (!client) throw new Error("Sync isn't configured on this site.");
  if (!session) throw new Error("You're signed out.");
  return session.user.id;
}
const redirectTo = () => location.origin + location.pathname;

window.EDAuth = {
  enabled,
  ready,
  googleEnabled: !!CFG.enableGoogle,
  contactEmail: CFG.contactEmail || "",

  user(){
    return session && session.user
      ? { id: session.user.id, email: session.user.email || "" }
      : null;
  },
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },

  async signInWithEmail(email){
    if (!client) throw new Error("Sign-in isn't configured on this site.");
    const { error } = await client.auth.signInWithOtp({
      email: String(email || "").trim(),
      options: { emailRedirectTo: redirectTo() }
    });
    if (error) throw new Error(friendly(error));
  },

  async signInWithGoogle(){
    if (!client) throw new Error("Sign-in isn't configured on this site.");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() }
    });
    if (error) throw new Error(friendly(error));
  },

  async signOut(){
    if (!client) return;
    try { await client.auth.signOut(); } catch(e){}
    session = null;
    emit();
  },

  /* Returns the signed-in person's saved papers, or null when signed out. */
  async fetchList(){
    if (!client || !session) return null;
    const { data, error } = await client
      .from("reading_list")
      .select("paper_id, data");
    if (error) throw new Error(friendly(error));
    return (data || [])
      .map(r => (r && r.data ? { ...r.data, id: r.paper_id } : null))
      .filter(Boolean);
  },

  async upsert(item){
    const uid = requireSession();
    const { error } = await client.from("reading_list").upsert({
      user_id: uid,
      paper_id: item.id,
      data: item,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,paper_id" });
    if (error) throw new Error(friendly(error));
  },

  async bulkUpsert(items){
    const uid = requireSession();
    if (!items.length) return;
    const now = new Date().toISOString();
    const rows = items.map(it => ({
      user_id: uid, paper_id: it.id, data: it, updated_at: now
    }));
    /* Chunked so a large first-time merge doesn't hit the request size limit. */
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await client.from("reading_list")
        .upsert(rows.slice(i, i + 100), { onConflict: "user_id,paper_id" });
      if (error) throw new Error(friendly(error));
    }
  },

  async remove(id){
    const uid = requireSession();
    const { error } = await client.from("reading_list")
      .delete().eq("user_id", uid).eq("paper_id", id);
    if (error) throw new Error(friendly(error));
  },

  async clear(){
    const uid = requireSession();
    const { error } = await client.from("reading_list").delete().eq("user_id", uid);
    if (error) throw new Error(friendly(error));
  },

  /* Asks the appraise Edge Function what the retrieved papers say about the question.
     Signed-in only, because the function spends a quota that someone has to own. */
  async appraise(question, papers){
    requireSession();
    const { data, error } = await client.functions.invoke("appraise", {
      body: { question, papers }
    });
    if (error) {
      let msg = "The appraisal service couldn't be reached.";
      try {
        const body = await error.context.json();
        if (body && body.message) msg = body.message;
      } catch(e){}
      throw new Error(msg);
    }
    if (!data || typeof data.verdict !== "string") {
      throw new Error("The appraisal came back in an unusable shape.");
    }
    return data;
  },

  /* Removes the saved papers and the account itself. Runs as a database function so it
     works with the public key without exposing anything that could delete someone else. */
  async deleteAccount(){
    requireSession();
    const { error } = await client.rpc("delete_my_account");
    if (error) throw new Error(friendly(error));
    session = null;
    emit();
  }
};

})();
