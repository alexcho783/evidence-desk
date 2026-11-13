/* Conspectus — counting visits without following people around.
 *
 * Nothing loads and nothing is sent unless config.js names a provider. With the provider
 * blank this file defines an object whose methods do nothing, so the rest of the app can
 * call them unconditionally and there is no script, no request and no cookie.
 *
 * The one rule this file exists to enforce: the query string never leaves the browser.
 * People's questions live in the URL as ?q=…, and a provider's default path handling is
 * location.pathname + location.search, which would post every question typed into the site
 * to a third party. So the default is switched off and the path is built here by hand.
 *
 * Events carry a fixed name from a short list and nothing else. No query, no filters, no
 * paper identifiers, no titles.
 */
(() => {
"use strict";

/* config.js declares ANALYTICS with a top-level const, which is a global binding reachable
   by name from any later script, though not a property of window. */
const CFG = (typeof ANALYTICS === "object" && ANALYTICS) || {provider:"", site:""};

/* Do Not Track and Global Privacy Control are a stated preference not to be counted. One
   is enough; neither is negotiable. */
function optedOut(){
  try {
    if (navigator.globalPrivacyControl === true) return true;
    const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    return dnt === "1" || dnt === "yes";
  } catch (e) { return false; }
}

/* ── Campaigns ─────────────────────────────────────────────────
 * Posts link in with utm parameters on the end. They are read once here, kept for the
 * provider and for the welcome banner, and then taken out of the address bar, so a link
 * anybody copies off this page carries the question and not the advert it came from.
 *
 * This part runs whether or not analytics is switched on: a clean URL is worth having on
 * its own. It runs before app.js, which is a module and therefore deferred, so the app's
 * own readUrl() never sees a utm parameter. readUrl() would ignore one anyway, since it
 * reads a fixed list of names, and pushUrl() builds its query from state alone and so
 * cannot write one back.
 */
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

const campaign = (() => {
  const blank = {source:"", medium:"", campaign:""};
  try {
    const p = new URLSearchParams(location.search);
    /* Narrowed to what a campaign name can contain, and capped, because these values go
       on to a third party and arrive from whatever anyone chose to put in a link. */
    const val = k => (p.get(k) || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
    return {source: val("utm_source"), medium: val("utm_medium"), campaign: val("utm_campaign")};
  } catch (e) { return blank; }
})();

function stripUtm(){
  try {
    const p = new URLSearchParams(location.search);
    let found = false;
    for (const k of UTM) if (p.has(k)) { p.delete(k); found = true; }
    if (!found) return;
    const qs = p.toString();
    /* Everything else in the query string is kept, and so is the fragment. replaceState
       rather than pushState: arriving from a post is not a step to go Back to. */
    history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } catch (e) {}
}

/* The only path ever sent: the pathname, with no query string on it at all. */
function path(){
  return location.pathname;
}

/* The only query string ever sent, built from an allow-list the way pushUrl() in app.js
   is. A provider reads the campaign out of the query string, so the three utm values go
   back here by themselves and nothing else can get in. Empty when nobody arrived from a
   campaign, and an empty value is dropped rather than sent. */
function campaignQuery(){
  const p = new URLSearchParams();
  if (campaign.source) p.set("utm_source", campaign.source);
  if (campaign.medium) p.set("utm_medium", campaign.medium);
  if (campaign.campaign) p.set("utm_campaign", campaign.campaign);
  const qs = p.toString();
  return qs ? "?" + qs : "";
}

/* Event names are matched against this rather than passed through, so a caller cannot turn
   a search term into an event name by accident. */
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

const PROVIDERS = {
  goatcounter: {
    boot(site, onReady){
      /* no_onload stops count.js sending anything by itself, which is what takes its
         default path handling out of the picture. no_events stops it binding its own
         click handlers, which read element text. */
      window.goatcounter = {
        no_onload: true,
        no_events: true,
        allow_local: !!CFG.allowLocal
      };
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://gc.zgo.at/count.js";
      s.setAttribute("data-goatcounter", "https://" + encodeURIComponent(site) + ".goatcounter.com/count");
      s.addEventListener("load", () => { this.seal(); onReady(); });
      s.addEventListener("error", () => {});
      document.head.appendChild(s);
    },

    /* count.js assembles its payload in get_data(), where it sets q to location.search
       outright. That is not reachable through the settings or through count()'s own
       arguments, and location.search is the question somebody typed, so without this the
       search text goes out on every hit beside the tidy path above. get_data is a plain
       property of window.goatcounter, so it is wrapped here and q is replaced with the
       campaign parameters alone. Checked against count.js as served on 13 November 2026;
       worth re-reading the payload in the network tab if GoatCounter ever changes it. */
    seal(){
      const gc = window.goatcounter;
      if (!gc || typeof gc.get_data !== "function" || gc._sealed) return;
      const original = gc.get_data;
      gc.get_data = function(vars){
        const d = original(vars || {});
        if (d) d.q = campaignQuery();
        return d;
      };
      gc._sealed = true;
    },
    pageview(p){
      window.goatcounter.count({path: p, title: "Conspectus"});
    },
    event(name){
      /* no_session, so a second search in the same visit is still counted. */
      window.goatcounter.count({path: name, title: name, event: true, no_session: true});
    }
  }

  /* Plausible would slot in here with the same three methods: boot() injecting
     plausible.js with the manual extension, pageview() calling plausible("pageview",
     {u: location.origin + p}), event() calling plausible(name). Nothing outside this
     object knows which provider is in use. */
};

const P = PROVIDERS[CFG.provider];
const ON = !!(P && CFG.site && !optedOut());

/* count.js is async, so calls made before it lands are held rather than dropped. */
let ready = false;
const queue = [];
function run(fn){
  if (!ON) return;
  if (ready) { try { fn(); } catch (e) {} }
  else queue.push(fn);
}

window.EDAnalytics = {
  enabled: ON,
  provider: ON ? CFG.provider : "",
  /* Read by app.js to decide whether to greet someone who arrived from a post. */
  campaign: campaign,
  pageview(){ run(() => P.pageview(path())); },
  event(name){ if (NAME.test(String(name || ""))) run(() => P.event(String(name))); }
};

if (ON) {
  P.boot(CFG.site, () => {
    ready = true;
    while (queue.length) { try { queue.shift()(); } catch (e) {} }
  });
  window.EDAnalytics.pageview();
}

/* Last, so the pageview above still has the campaign to report. */
stripUtm();

})();
