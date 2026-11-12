/* Conspectus — account sync configuration.
 *
 * Accounts are OPTIONAL. Leave this file exactly as it is and the site works the way it
 * always has: everything in the browser, no sign-in, nothing transmitted. Fill the two
 * values in and a "Sign in to sync" option appears, letting people keep their reading
 * list across devices.
 *
 * Both values below are PUBLIC by design. The anon key is meant to ship in client code;
 * it grants no access on its own. What protects people's data is row-level security in
 * the database (see supabase-setup.sql), which makes it impossible for one signed-in
 * person to read or write another's rows. Committing this file is fine.
 *
 * Never put the service_role key here. That one bypasses row-level security entirely and
 * belongs only on a server, which this project does not have.
 *
 * Setup is in README.md under "Optional: accounts".
 */
window.ED_CONFIG = {
  // From your Supabase project: Settings → API → Project URL
  supabaseUrl: "https://mrsfkaeklaaduzxpnxdh.supabase.co",

  // From your Supabase project: Settings → API → Project API keys → anon / public
  supabaseAnonKey: "sb_publishable_2wHbIuvutWFcaI4clK18yg_w6jQvrsA",

  // Show a "Continue with Google" button. Requires Google to be enabled under
  // Authentication → Providers in Supabase. Email links work without this.
  enableGoogle: false,

  // Shown in the privacy notice so people know who holds their data. Required by UK GDPR
  // if you run this with accounts switched on.
  contactEmail: "alexanderchohj@gmail.com",

  // An email address sent to Crossref and Unpaywall with each lookup. Both ask for one so
  // they can contact whoever is making the requests; Unpaywall refuses to answer without
  // it, and rejects obvious placeholders.
  //
  // READ THIS BEFORE FILLING IT IN. The call is made by each visitor's browser, so this
  // address is sent to Crossref and Unpaywall by everyone who uses the site, and it is
  // readable by anyone who opens the developer tools. Use an address you are content to
  // publish, not a personal one you would rather keep quiet.
  //
  // Left blank, the retraction recheck still works, because Crossref answers without it.
  // The Unpaywall free-copy lookup stays switched off, because Unpaywall will not answer.
  apiContact: ""
};
