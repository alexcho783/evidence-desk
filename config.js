/* Evidence Desk — account sync configuration.
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
  supabaseUrl: "",

  // From your Supabase project: Settings → API → Project API keys → anon / public
  supabaseAnonKey: "",

  // Show a "Continue with Google" button. Requires Google to be enabled under
  // Authentication → Providers in Supabase. Email links work without this.
  enableGoogle: false,

  // Shown in the privacy notice so people know who holds their data. Required by UK GDPR
  // if you run this with accounts switched on.
  contactEmail: ""
};
