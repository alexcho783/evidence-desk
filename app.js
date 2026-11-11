/* Evidence Desk — public edition
 * Literature from Europe PMC (https://europepmc.org). No tracking, and no AI anywhere.
 * Accounts are optional and off unless config.js is filled in.
 * Reading list and notes persist in localStorage; recent searches are session-scoped.
 */
(() => {
"use strict";

/* ══ Constants ═══════════════════════════════════════════ */

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const PAGE = 25;
const Y = new Date().getFullYear();

/* Two literatures, two ladders. Medicine and psychology do not rank evidence the same way:
   a controlled lab experiment is central to psychology and marginal to clinical medicine,
   qualitative work is real evidence in one and barely appears in the other. Relabelling a
   medical ladder would misrepresent both, so each field gets its own, drawn from the same
   shared set of tiers so a mixed reading list still sorts sensibly. */
const TIER = {
  synthesis:   {label:"Synthesis",     note:"Meta-analysis · systematic review", w:"strong", rank:0, noun:["synthesis","syntheses"]},
  guideline:   {label:"Guideline",     note:"Practice guideline · consensus",    w:"strong", rank:1, noun:["guideline","guidelines"]},
  trial:       {label:"Trial",         note:"Randomised · controlled",           w:"strong", rank:2, noun:["trial","trials"]},
  cohort:      {label:"Observational", note:"Cohort · case–control",             w:"mid",    rank:3, noun:["cohort study","cohort studies"]},
  experiment:  {label:"Experiment",    note:"Controlled lab study",              w:"mid",    rank:4, noun:["experiment","experiments"]},
  survey:      {label:"Survey",        note:"Cross-sectional · correlational",   w:"weak",   rank:5, noun:["survey","surveys"]},
  qualitative: {label:"Qualitative",   note:"Interview · thematic analysis",     w:"weak",   rank:6, noun:["qualitative study","qualitative studies"]},
  case:        {label:"Case",          note:"Case report · series",              w:"weak",   rank:7, noun:["case report","case reports"]},
  preclinical: {label:"Preclinical",   note:"Animal · in vitro · modelling",     w:"weak",   rank:8, noun:["preclinical study","preclinical studies"]},
  phase3:      {label:"Phase 3",       note:"Pivotal efficacy",                  w:"strong", rank:2.1, noun:["phase 3 trial","phase 3 trials"]},
  phase4:      {label:"Phase 4",       note:"Post-marketing",                    w:"strong", rank:2.2, noun:["phase 4 trial","phase 4 trials"]},
  obsreg:      {label:"Observational", note:"Registry · cohort",                 w:"mid",    rank:3.1, noun:["observational study","observational studies"]},
  phase2:      {label:"Phase 2",       note:"Efficacy · dose-finding",           w:"mid",    rank:4.1, noun:["phase 2 trial","phase 2 trials"]},
  phase1:      {label:"Phase 1",       note:"Safety · dosing",                   w:"weak",   rank:7.1, noun:["phase 1 trial","phase 1 trials"]},
  nophase:     {label:"Unphased",      note:"Device · behavioural · other",      w:"weak",   rank:8.1, noun:["unphased study","unphased studies"]},
  narrative:   {label:"Narrative",     note:"Review · comment · editorial",      w:"weak",   rank:9, noun:["review","reviews"]}
};

const SOURCES = {
  med: {
    label:"Medicine", short:"Med", db:"Europe PMC",
    ladder:["synthesis","guideline","trial","cohort","case","preclinical","narrative"],
    overrides:{},
    placeholder:"Ask a clinical question, or paste a DOI or PMID"
  },
  psy: {
    label:"Psychology", short:"Psy", db:"OpenAlex",
    ladder:["synthesis","trial","experiment","cohort","survey","qualitative","case","narrative"],
    overrides:{ cohort:{label:"Longitudinal", note:"Prospective · follow-up", noun:["longitudinal study","longitudinal studies"]} },
    placeholder:"Ask a psychology question, or paste a DOI"
  },
  trials: {
    label:"Trials", short:"Trials", db:"ClinicalTrials.gov",
    ladder:["phase3","phase4","obsreg","phase2","phase1","nophase"],
    overrides:{},
    placeholder:"Search trials by condition or drug"
  }
};

const src = () => SOURCES[S.source] || SOURCES.med;
/* The active ladder, as a list of {k, label, note, w}. */
function tiers(){
  const s = src();
  return s.ladder.map(k => ({ k, ...TIER[k], ...(s.overrides[k] || {}) }));
}
function tierMeta(k){
  const s = src();
  return { ...(TIER[k] || TIER.narrative), ...((s.overrides || {})[k] || {}) };
}

const ERA_COLS = [
  {k:"old", label:"Before " + (Y-14), sub:"Older work",    test:p => !!p.year && p.year <  Y-14},
  {k:"mid", label:(Y-14) + "–" + (Y-5), sub:"Established", test:p => !!p.year && p.year >= Y-14 && p.year <= Y-5},
  {k:"new", label:(Y-4) + "–now",     sub:"Current",       test:p => !!p.year && p.year >= Y-4}
];


/* For registered trials the informative axis is not when they ran but whether they ever
   reported. A completed trial with no results posted is the publication-bias signal that
   no database of published papers can show you. */
const TRIAL_COLS = [
  {k:"reported", label:"Reported",   sub:"Results posted",       test:p => p.trialResults === true},
  {k:"silent",   label:"Unreported", sub:"Finished, no results", test:p => p.trialResults === false && p.trialDone === true},
  {k:"ongoing",  label:"Ongoing",    sub:"Still running",        test:p => p.trialDone === false}
];
const cols = () => (S.source === "trials" ? TRIAL_COLS : ERA_COLS);

const DESIGN_FILTERS = [
  {k:"any",    label:"Any design",            q:""},
  {k:"synth",  label:"Syntheses & guidelines", q:'(PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Practice Guideline")'},
  {k:"trial",  label:"Trials only",            q:'(PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Clinical Trial")'},
  {k:"obs",    label:"Observational only",     q:'(PUB_TYPE:"Observational Study")'},
  {k:"case",   label:"Case reports only",      q:'(PUB_TYPE:"Case Reports")'}
];

const SORTS = [
  {k:"relevance", label:"Relevance", q:""},
  {k:"recent",    label:"Newest",    q:"P_PDATE_D desc"},
  {k:"cited",     label:"Most cited", q:"CITED desc"}
];

const EXAMPLES = [
  {tag:"Neuro",   q:"PMP22 overexpression Charcot-Marie-Tooth 1A treatment"},
  {tag:"Cardio",  q:"SGLT2 inhibitors heart failure mortality"},
  {tag:"Infect",  q:"short course antibiotics community acquired pneumonia"},
  {tag:"Public",  q:"intensive blood pressure lowering dementia risk"}
];

const LS = {list:"ed-reading-list", recent:"ed-recent", theme:"ed-theme", colls:"ed-collections"};

/* ══ State ═══════════════════════════════════════════ */

const S = {
  view:"search",
  q:"", lastQ:"",
  source:"med",
  plotOpen:false,   /* mobile only: the full grid is collapsed until asked for */
  coll:"all", citeStyle:"vancouver", exporting:false, renaming:false, confirmColl:false,
  chainLabel:"",    /* set while showing the papers that cite a given paper */
  hint:"",          /* shown when Search is pressed with nothing typed */
  design:"any", sort:"relevance", openOnly:false, yearFrom:"", yearTo:"",
  busy:false, loadingMore:false,
  results:[], hitCount:0, cursor:"*", exhausted:false,
  err:null,
  list:new Map(), recent:[],
  filter:"",
  open:null, confirmDel:false, confirmClear:false,
  /* Accounts are optional; everything below stays inert when config.js is blank. */
  account:{user:null, busy:false, note:"", synced:false, sent:"", confirmWipe:false},
  signIn:false
};

/* ══ Helpers ═══════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const EDCITE = () => window.EDCite || {STYLES:[], toDocxBlob:null};
const esc = s => String(s == null ? "" : s)
  .replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const svg = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

/* Europe PMC stores HTML entities in titles and abstracts ("Prevention &amp; Rehabilitation").
   Decode once on the way in; everything is escaped again on the way out. A detached textarea
   parses its contents as raw text, so nothing here can execute. */
/* Europe PMC and OpenAlex both put markup inside titles and abstracts, for example
   <i>PMP22</i> for a gene name. esc() stops it executing, so it was being shown as
   literal angle brackets instead. Strip the tags once, on the way in. */
const PARSER = new DOMParser();
function plain(v){
  const t = String(v == null ? "" : v);
  if (t.indexOf("<") === -1) return t;
  try { return PARSER.parseFromString(t, "text/html").body.textContent || ""; }
  catch (e) { return t.replace(/<[^>]+>/g, ""); }
}

const DECODER = document.createElement("textarea");
function dec(s){
  if (!s) return "";
  DECODER.innerHTML = String(s);
  return DECODER.value;
}
const slug = s => (String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)) || "x";

function store(key, val){
  try {
    if (val === undefined) {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
    localStorage.setItem(key, JSON.stringify(val));
  } catch(e){ /* private window, blocked storage — the page works without it */ }
  return null;
}

/* Recent searches are deliberately session-scoped. The reading list is something you
   choose to keep; your search history is not, and on a shared computer it must not
   outlive the browsing session or be readable by whoever sits down next. */
function sessionStore(key, val){
  try {
    if (val === undefined) {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
    sessionStorage.setItem(key, JSON.stringify(val));
  } catch(e){}
  return null;
}
function purge(key){
  try { localStorage.removeItem(key); } catch(e){}
  try { sessionStorage.removeItem(key); } catch(e){}
}

let toastT = null;
function toast(msg){
  $("toast-root").innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toastT);
  toastT = setTimeout(() => { $("toast-root").innerHTML = ""; }, 3200);
}

/* ══ Theme ═══════════════════════════════════════════ */

(function theme(){
  const t = store(LS.theme);
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  $("theme-btn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    store(LS.theme, next);
  });
})();

/* ══ Reading list ═══════════════════════════════════════════ */

function loadList(){
  const raw = store(LS.list) || [];
  S.list = new Map(raw.map(p => [p.id, p]));
  /* Earlier versions kept recent searches in localStorage, where they survived the
     browser closing and were there for whoever opened it next. Clear anything left
     behind by those versions before reading the session-scoped copy. */
  try { localStorage.removeItem(LS.recent); } catch(e){}
  S.recent = sessionStore(LS.recent) || [];
}
function saveList(){ store(LS.list, [...S.list.values()]); }

/* Collections live on the papers themselves, so they sync with the reading list and need
   no table of their own. An extra list of names is kept locally so a collection you have
   just made, and not yet filled, does not vanish on the next render. */
function collNames(){
  const fromPapers = new Set();
  for (const p of S.list.values()) for (const c of (p.collections || [])) fromPapers.add(c);
  for (const c of (store(LS.colls) || [])) fromPapers.add(c);
  return [...fromPapers].sort((a, b) => a.localeCompare(b));
}
function rememberColl(name){
  const names = new Set(store(LS.colls) || []);
  names.add(name);
  store(LS.colls, [...names]);
}
function forgetColl(name){
  store(LS.colls, (store(LS.colls) || []).filter(c => c !== name));
}
function setCollections(id, list){
  const cur = S.list.get(id);
  if (!cur) return;
  cur.collections = list;
  persist({type:"upsert", item:cur});
}
/* Renaming touches every member, since membership is stored on the paper. */
function renameColl(from, to){
  to = clean(to);
  if (!to || to === from) return;
  const touched = [];
  for (const p of S.list.values()) {
    if ((p.collections || []).includes(from)) {
      p.collections = [...new Set(p.collections.map(c => c === from ? to : c))];
      touched.push(p);
    }
  }
  forgetColl(from); rememberColl(to);
  if (S.coll === from) S.coll = to;
  if (touched.length) persist({type:"bulk", items:touched});
  else saveList();
  render();
}
function deleteColl(name){
  const touched = [];
  for (const p of S.list.values()) {
    if ((p.collections || []).includes(name)) {
      p.collections = p.collections.filter(c => c !== name);
      touched.push(p);
    }
  }
  forgetColl(name);
  if (S.coll === name) S.coll = "all";
  if (touched.length) persist({type:"bulk", items:touched});
  else saveList();
  render();
}
const clean = v => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, 60);

/* The in-memory list is what the page renders. localStorage is a mirror, so the list is
   there instantly on load and keeps working offline. When someone is signed in the same
   change also goes to their account, in the background — a failure there degrades to
   "saved on this device" rather than losing the change. */
function persist(change){
  saveList();
  const A = window.EDAuth;
  if (!A || !A.enabled || !A.user()) return;
  const fail = e => {
    S.account.note = (e && e.message) || "That change is saved on this device only.";
    render();
  };
  try {
    if (change.type === "upsert")      A.upsert(change.item).catch(fail);
    else if (change.type === "bulk")   A.bulkUpsert(change.items).catch(fail);
    else if (change.type === "delete") A.remove(change.id).catch(fail);
    else if (change.type === "clear")  A.clear().catch(fail);
  } catch (e) { fail(e); }
}

/* ══ Account sync ═══════════════════════════════════════════ */

async function syncAfterSignIn(){
  const A = window.EDAuth;
  S.account.busy = true; S.account.note = ""; S.account.synced = false;
  render();
  try {
    const local = [...S.list.values()];
    const remote = await A.fetchList();
    const byId = new Map((remote || []).map(p => [p.id, p]));
    /* Papers saved on this device before signing in are merged up rather than dropped.
       Where both sides have the same paper the account's copy wins, since it may carry
       a note written on another device. */
    const toPush = local.filter(p => !byId.has(p.id));
    if (toPush.length) await A.bulkUpsert(toPush);
    for (const p of toPush) byId.set(p.id, p);
    S.list = byId;
    saveList();
    S.account.synced = true;
    S.account.note = toPush.length
      ? `${toPush.length} paper${toPush.length === 1 ? "" : "s"} from this device added to your account.`
      : "";
  } catch (e) {
    S.account.note = (e && e.message) || "Couldn't load your saved papers.";
  }
  S.account.busy = false;
  render();
}

async function signInGoogle(){
  try { await window.EDAuth.signInWithGoogle(); }
  catch (e) { S.account.note = (e && e.message) || "Couldn't start Google sign-in."; renderSheet(); }
}

async function sendMagicLink(email){
  S.account.busy = true; S.account.note = ""; renderSheet();
  try {
    await window.EDAuth.signInWithEmail(email);
    S.account.sent = email;
  } catch (e) {
    S.account.note = (e && e.message) || "Couldn't send the sign-in link.";
  }
  S.account.busy = false;
  renderSheet();
}

async function deleteAccount(){
  S.account.busy = true; S.account.wiped = true; render();
  try {
    await window.EDAuth.deleteAccount();
    S.list.clear();
    try { localStorage.removeItem(LS.list); } catch(e){}
    S.account.confirmWipe = false;
    S.account.synced = false;
    S.account.note = "";
    toast("Your account and everything saved to it have been deleted.");
  } catch (e) {
    S.account.wiped = false;
    S.account.note = (e && e.message) || "Couldn't delete the account.";
  }
  S.account.busy = false;
  render();
}

function onAuthChange(){
  const A = window.EDAuth;
  const u = A ? A.user() : null;
  const was = S.account.user;
  S.account.user = u;

  if (u && (!was || was.id !== u.id)) {
    S.signIn = false; S.account.sent = "";
    syncAfterSignIn();
    return;
  }
  if (!u && was) {
    if (S.account.wiped) { S.account.wiped = false; render(); return; }
    /* Signing out has to leave nothing behind, or accounts would make the shared-computer
       problem worse rather than better. The one exception is a list that never finished
       syncing: wiping that would destroy the only copy. */
    if (S.account.synced) {
      S.list.clear();
      try { localStorage.removeItem(LS.list); } catch(e){}
      S.account.note = "";
      toast("Signed out. This device has been cleared.");
    } else {
      S.account.note = "";
      toast("Signed out. Your saved papers stayed on this device — they hadn't finished syncing.");
    }
    S.account.synced = false;
    S.account.confirmWipe = false;
    render();
    return;
  }
  render();
}

function addRecent(q){
  S.recent = [q, ...S.recent.filter(x => x !== q)].slice(0, 8);
  sessionStore(LS.recent, S.recent);
}
function clearRecent(){
  S.recent = [];
  purge(LS.recent);
  render();
  toast("Search history cleared.");
}

/* ══ Classification ═══════════════════════════════════════════
 * Study design comes from the publication types Europe PMC carries over from MEDLINE.
 * Where a record has none, we fall back to reading the abstract, and say so on the card. */

function classify(r){
  const types = new Set(((r.pubTypeList && r.pubTypeList.pubType) || []).map(t => String(t).toLowerCase()));
  let why = "";
  const has = (...xs) => { const hit = xs.find(x => types.has(x)); if (hit) why = hit; return !!hit; };
  const txt = ((r.title || "") + " " + (r.abstractText || "")).toLowerCase();
  const ttl = String(r.title || "").toLowerCase();
  const re = x => { const m = x.exec(txt); if (m) why = m[0].trim(); return !!m; };

  if (has("meta-analysis"))      return {design:"Meta-analysis",   tier:"synthesis", src:"metadata", because: why};
  if (has("systematic review"))  return {design:"Systematic review", tier:"synthesis", src:"metadata", because: why};
  if (has("practice guideline","guideline","consensus development conference"))
                                 return {design:"Guideline",       tier:"guideline", src:"metadata", because: why};
  if (has("consensus statement")) return {design:"Consensus statement", tier:"guideline", src:"metadata", because: why};
  if (has("randomized controlled trial"))
                                 return {design:"Randomised controlled trial", tier:"trial", src:"metadata", because: why};
  for (const t of types) {
    if (t.startsWith("clinical trial") || t === "pragmatic clinical trial" || t === "controlled clinical trial")
      return {design:"Clinical trial", tier:"trial", src:"metadata", because: why};
  }
  if (has("case reports"))       return {design:"Case report",     tier:"case", src:"metadata", because: why};
  if (has("observational study")) return {design:"Observational study", tier:"cohort", src:"metadata", because: why};
  /* One deliberate exception to "metadata always wins": Europe PMC's Review type is a
     coarse supertype that covers systematic reviews and narrative ones alike, and it does
     not apply Systematic Review to most of them. So a specific synthesis phrase upgrades a
     Review, while anything more specific above has already returned.
     The title is trusted on its own. In the abstract the phrase must sit next to a verb of
     conducting, otherwise a trial that merely cites a meta-analysis would match. */
  const synthTitle = /systematic review|meta-analys|meta analys|network meta|umbrella review/.test(ttl);
  const synthBody = re(/\b(we|this (study|review|paper|article))\b[^.]{0,60}(systematic review|meta-analys|meta analys)/)
    || re(/\b(conducted|performed|undertook|report)\b[^.]{0,40}(systematic review|meta-analys|meta analys)/)
    || re(/\bprisma\b/);
  if (synthTitle || synthBody) {
    if (synthTitle) why = (ttl.match(/systematic review|meta-analys\w*|network meta\w*|umbrella review/) || [""])[0];
    /* The title decides when it says anything; only a body-triggered match falls back
       to the body, or a plain systematic review is called a meta-analysis. */
    const isMeta = /meta-analys|meta analys|network meta/.test(ttl)
      || (!synthTitle && re(/\bmeta-analys/));
    return {design: isMeta ? "Meta-analysis" : "Systematic review", tier:"synthesis", src:"inferred", because: why};
  }
  if (/scoping review|narrative review|literature review/.test(ttl)) {
    why = (ttl.match(/scoping review|narrative review|literature review/) || [""])[0];
    return {design:"Review", tier:"narrative", src:"inferred", because: why};
  }

  /* Every indexed type is checked before any keyword guess. A record Europe PMC types as a
     review must never come back as a trial because its abstract mentions randomisation. */
  if (has("review","review-article")) return {design:"Review", tier:"narrative", src:"metadata", because: why};
  if (has("editorial","comment","letter","news","published erratum"))
                                 return {design:"Comment", tier:"narrative", src:"metadata", because: why};

  /* No design in the metadata — read the abstract instead. */
  /* "randomised" on its own appears in any paper that discusses trials, and "participants
     were" appears in almost every human study. Both matched far too much. */
  const humanTrial = re(/\b(were|was) randomi[sz]ed|randomly (assigned|allocated)|randomi[sz]ed to|(double|single|triple)-blind|placebo-controlled|open-label,? randomi[sz]ed|phase (ii|iii|2|3) trial/);
  /* Text that talks about trials without being one. */
  const aboutTrials = re(/target trial emulation|propensity[- ]score|retrospective|real-world|compared with randomi[sz]ed trials|pooled analysis of/);
  const animal = re(/\bmice\b|\bmouse\b|murine|\brats?\b|in vitro|cell lines?|ipsc|non-human primate|macaca|zebrafish|knockout|transgenic|preclinical|organoid/);
  if (animal && !humanTrial) return {design: re(/in vitro|cell lines?|ipsc|organoid/) ? "In vitro" : "Animal study", tier:"preclinical", src:"inferred", because: why};
  if (humanTrial && !aboutTrials) return {design:"Trial",       tier:"trial",  src:"inferred", because: why};
  if (re(/\bcohort\b|prospectively followed|longitudinal|years of follow-up/))
                             return {design:"Cohort study",     tier:"cohort", src:"inferred", because: why};
  if (re(/case-control|case–control/))
                             return {design:"Case–control",     tier:"cohort", src:"inferred", because: why};
  if (re(/cross-sectional|prevalence survey|registry analysis|questionnaire survey/))
                             return {design:"Cross-sectional",  tier:"cohort", src:"inferred", because: why};
  if (re(/consecutive (series|patients|children)|case series|we (describe|report) \d+ (patients|children|cases)/))
                             return {design:"Case series",      tier:"case",   src:"inferred", because: why};
  if (re(/we report a case|index patient|we present a (patient|case)/))
                             return {design:"Case report",      tier:"case",   src:"inferred", because: why};
  if (re(/simulation|mathematical model|computational model|in silico/))
                             return {design:"Modelling",        tier:"preclinical", src:"inferred", because: why};
  if (re(/this review|we review|this article reviews|overview of/))
                             return {design:"Review",           tier:"narrative", src:"inferred", because: why};
  /* Commentaries are short and refer to another paper rather than reporting anything. */
  if ((r.abstractText || "").length < 1200
      && re(/in a recent issue|in this issue|this commentary|this perspective|accompanying (article|paper|trial)/))
                             return {design:"Commentary",       tier:"narrative", src:"inferred", because: why};
  return {design:"Design unclear", tier:"narrative", src:"inferred", because: ""};
}

function findN(r){
  const t = (r.abstractText || "");
  const m = t.match(/\bn\s*=\s*([\d,]{1,9})/i)
         || t.match(/([\d,]{2,9})\s+(?:patients|participants|subjects|individuals|adults|children|women|men)\b/i);
  if (!m) return null;
  const v = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(v) && v > 1 && v < 1e8 ? v : null;
}

/* ══ OpenAlex (psychology) ═══════════════════════════════════════════
 * Europe PMC barely covers psychology outside psychiatry, so the psychology source is
 * OpenAlex, filtered to its Psychology field. The trade is real and shows in the interface:
 * OpenAlex carries no publication types, so every design here is read off the abstract and
 * marked "inferred", where medicine gets its design from human indexers at the NLM. */

const OPENALEX = "https://api.openalex.org/works";
const PSYCH_FIELD = "primary_topic.field.id:fields/32";

/* OpenAlex stores abstracts as a word -> positions map, for licensing reasons. */
function fromInverted(inv){
  if (!inv || typeof inv !== "object") return "";
  const out = [];
  for (const word of Object.keys(inv)) {
    const positions = inv[word];
    if (Array.isArray(positions)) for (const p of positions) out[p] = word;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function classifyPsy(title, abstract, type){
  const t = ((title || "") + " " + (abstract || "")).toLowerCase();
  const re = x => x.test(t);

  if (re(/meta-analy|systematic review|meta-analytic/))
    return {design: re(/meta-analy/) ? "Meta-analysis" : "Systematic review", tier:"synthesis"};
  if (re(/randomi[sz]ed controlled trial|\brct\b|randomly assigned to (?:one of )?(?:two|three|the|a )|randomi[sz]ed to receive/))
    return {design:"Randomised controlled trial", tier:"trial"};
  if (re(/semi-structured interview|thematic analysis|grounded theory|focus group|qualitative (?:study|analysis|design)|interpretative phenomenological/))
    return {design:"Qualitative study", tier:"qualitative"};
  if (re(/within-subjects|between-subjects|participants were (?:randomly )?(?:assigned|allocated)|experiment [123]\b|in two experiments|counterbalanced|reaction times?|stimuli were/))
    return {design:"Experiment", tier:"experiment"};
  if (re(/longitudinal|cohort|follow-up (?:period|assessment|at)|across (?:three|four|five|two) waves|prospectively/))
    return {design:"Longitudinal study", tier:"cohort"};
  if (re(/cross-sectional|questionnaire|self-report measures|survey of|correlational|online panel/))
    return {design:"Survey", tier:"survey"};
  if (re(/case study|single case|case series/))
    return {design:"Case study", tier:"case"};
  if (type === "review" || re(/this review|we review|theoretical framework|narrative review|commentary/))
    return {design:"Review", tier:"narrative"};
  return {design:"Design unclear", tier:"narrative"};
}

function normalisePsy(w){
  const abstract = fromInverted(w.abstract_inverted_index);
  const title = plain(String(w.display_name || w.title || "Untitled")).replace(/\.$/, "");
  const c = classifyPsy(title, abstract, w.type);
  const srcInfo = (w.primary_location && w.primary_location.source) || {};
  const doi = typeof w.doi === "string" ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : "";
  const authors = (w.authorships || []).map(a => (a.author && a.author.display_name) || "").filter(Boolean);
  const pmid = ((w.ids || {}).pmid || "").replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "").replace(/\/$/, "");
  return {
    id: "OA:" + String(w.id || "").split("/").pop(),
    title,
    authors: authors.length > 3 ? authors[0] + " et al." : authors.join(", "),
    journal: srcInfo.display_name || "",
    year: w.publication_year || null,
    doi, pmid,
    citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
    openAccess: !!((w.open_access || {}).is_oa),
    abstract,
    design: c.design, tier: c.tier,
    designSrc: "inferred",
    n: findN({abstractText: abstract}),
    url: doi ? "https://doi.org/" + doi : (w.id || ""),
    epmc: w.id || "",
    fullText: ((w.best_oa_location || {}).landing_page_url) || "",
    source: "psy",
    retracted: !!w.is_retracted,
    grants: ((w.grants || []).map(g => String(g.funder_display_name || "")).filter(Boolean))
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 4),
    freeFullText: ((w.best_oa_location || {}).landing_page_url) || "",
    nctIds: [...new Set((abstract.match(/\bNCT\d{8}\b/g) || []))].slice(0, 3),
    openalexId: String(w.id || "").split("/").pop(),
    concern: false, erratum: false,
    preprint: w.type === "preprint",
    journalAbbrev: "",
    volume: ((w.biblio || {}).volume) || "",
    issue: ((w.biblio || {}).issue) || "",
    pages: [(w.biblio || {}).first_page, (w.biblio || {}).last_page].filter(Boolean).join("-"),
    /* OpenAlex gives one display name, so the surname is taken as the last word and the
       rest become initials. Wrong for a few compound surnames; flagged in the export. */
    authorList: (w.authorships || []).map(a => {
      const nm = ((a.author || {}).display_name || "").trim().split(/\s+/);
      if (!nm.length || !nm[0]) return null;
      const last = nm.pop();
      return { last, first: nm.join(" "), initials: nm.map(x => x[0]).join("") };
    }).filter(Boolean)
  };
}

async function fetchOpenAlex(cursor, signal){
  const p = new URLSearchParams();
  const doiHit = String(S.q).match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  if (doiHit) {
    /* A DOI lookup should not be narrowed to one field, or it finds nothing. */
    const u = new URLSearchParams({filter: "doi:" + doiHit[1].replace(/[.,;)\]]+$/, ""), "per-page": "1"});
    const r = await fetch(OPENALEX + "?" + u.toString(), {headers:{Accept:"application/json"}, signal})
      .catch(e => { if (aborted(e)) throw e; throw {kind:"network"}; });
    if (!r.ok) throw {kind:"server", status:r.status};
    const dd = await r.json().catch(() => { throw {kind:"parse"}; });
    return {rows:(dd.results || []).map(normalisePsy), hitCount:(dd.meta || {}).count || 0, next:null};
  }
  p.set("search", S.q.trim());
  const filters = [PSYCH_FIELD];
  if (S.openOnly) filters.push("is_oa:true");
  const from = /^\d{4}$/.test(S.yearFrom) ? S.yearFrom : null;
  const to   = /^\d{4}$/.test(S.yearTo)   ? S.yearTo   : null;
  if (from || to) filters.push(`publication_year:${from || "1800"}-${to || Y}`);
  p.set("filter", filters.join(","));
  p.set("per-page", String(PAGE));
  p.set("cursor", cursor || "*");
  if (S.sort === "recent") p.set("sort", "publication_date:desc");
  else if (S.sort === "cited") p.set("sort", "cited_by_count:desc");

  let res;
  try { res = await fetch(OPENALEX + "?" + p.toString(), {headers:{Accept:"application/json"}, signal}); }
  catch (e) { if (aborted(e)) throw e; throw {kind: navigator.onLine === false ? "offline" : "network"}; }
  if (res.status === 400 || res.status === 403) throw {kind:"badquery"};
  if (res.status === 429) throw {kind:"rate"};
  if (!res.ok) throw {kind:"server", status:res.status};
  let data;
  try { data = await res.json(); } catch(e) { throw {kind:"parse"}; }
  return {
    rows: (data.results || []).map(normalisePsy),
    hitCount: (data.meta && data.meta.count) || 0,
    next: (data.meta && data.meta.next_cursor) || null
  };
}

/* ══ ClinicalTrials.gov (registered trials) ═══════════════════════════════════════════
 * Not papers. These are trials as registered, which is the one thing a database of
 * published literature cannot show: studies that finished and never reported. The tiers
 * are phases rather than study designs, and the columns are reporting status rather than
 * era, because "did this ever report?" is the question worth asking of a registry. */

const CTGOV = "https://clinicaltrials.gov/api/v2/studies";
const TRIAL_DONE = ["COMPLETED","TERMINATED","WITHDRAWN","SUSPENDED","UNKNOWN"];

function normaliseTrial(st){
  const p = st.protocolSection || {};
  const idm = p.identificationModule || {};
  const sm = p.statusModule || {};
  const dm = p.designModule || {};
  const nct = idm.nctId || "";
  const phases = dm.phases || [];
  const studyType = dm.studyType || "";
  const status = sm.overallStatus || "";

  let tier = "nophase", design = "Unphased";
  if (studyType === "OBSERVATIONAL") { tier = "obsreg"; design = "Observational"; }
  else if (phases.includes("PHASE4")) { tier = "phase4"; design = "Phase 4"; }
  else if (phases.includes("PHASE3")) { tier = "phase3"; design = "Phase 3"; }
  else if (phases.includes("PHASE2")) { tier = "phase2"; design = "Phase 2"; }
  else if (phases.includes("PHASE1")) { tier = "phase1"; design = "Phase 1"; }

  const dateOf = k => ((sm[k] || {}).date || "");
  const year = parseInt((dateOf("primaryCompletionDateStruct") || dateOf("completionDateStruct")
    || dateOf("startDateStruct")).slice(0, 4), 10) || null;

  return {
    id: "CT:" + nct,
    title: plain(idm.briefTitle || idm.officialTitle || "Untitled"),
    authors: ((p.sponsorCollaboratorsModule || {}).leadSponsor || {}).name || "",
    journal: "", year,
    doi: "", pmid: "",
    citations: null,
    openAccess: false,
    abstract: (p.descriptionModule || {}).briefSummary || "",
    design, tier,
    designSrc: "registry",        /* from the registry itself, so never marked inferred */
    n: typeof (dm.enrollmentInfo || {}).count === "number" ? dm.enrollmentInfo.count : null,
    url: nct ? "https://clinicaltrials.gov/study/" + nct : "",
    epmc: nct ? "https://clinicaltrials.gov/study/" + nct : "",
    fullText: "",
    source: "trials",
    nct,
    trialStatus: status ? status.replace(/_/g, " ").toLowerCase().replace(/^./, m => m.toUpperCase()) : "",
    trialResults: !!st.hasResults,
    trialDone: TRIAL_DONE.includes(status)
  };
}

async function fetchTrials(cursor, signal){
  const p = new URLSearchParams();
  p.set("query.term", S.q.trim());
  p.set("pageSize", String(PAGE));
  p.set("format", "json");
  p.set("countTotal", "true");
  if (S.sort === "recent") p.set("sort", "StartDate:desc");
  if (cursor && cursor !== "*") p.set("pageToken", cursor);

  let res;
  try { res = await fetch(CTGOV + "?" + p.toString(), {headers:{Accept:"application/json"}, signal}); }
  catch (e) { if (aborted(e)) throw e; throw {kind: navigator.onLine === false ? "offline" : "network"}; }
  if (res.status === 400) throw {kind:"badquery"};
  if (res.status === 429) throw {kind:"rate"};
  if (!res.ok) throw {kind:"server", status:res.status};
  let data;
  try { data = await res.json(); } catch(e) { throw {kind:"parse"}; }
  return {
    rows: (data.studies || []).map(normaliseTrial),
    hitCount: data.totalCount || 0,
    next: data.nextPageToken || null
  };
}

/* ══ Europe PMC ═══════════════════════════════════════════ */

/* A pasted identifier is a lookup, not a phrase search. Recognising it here means the
   search box doubles as "add this specific paper" with no extra UI. */
function identifierQuery(raw){
  const q = String(raw || "").trim();
  const doi = q.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  if (doi) return `DOI:"${doi[1].replace(/[.,;)\]]+$/, "")}"`;
  const pmid = q.match(/^(?:pmid[:\s]*)?(\d{7,8})$/i);
  if (pmid) return `EXT_ID:${pmid[1]}`;
  return null;
}

function buildQuery(){
  const ident = identifierQuery(S.q);
  if (ident) return ident;
  const parts = [S.q.trim()];
  const d = DESIGN_FILTERS.find(x => x.k === S.design);
  if (d && d.q) parts.push(d.q);
  if (S.openOnly) parts.push("(OPEN_ACCESS:y)");
  const from = /^\d{4}$/.test(S.yearFrom) ? S.yearFrom : null;
  const to   = /^\d{4}$/.test(S.yearTo)   ? S.yearTo   : null;
  if (from || to) parts.push(`(PUB_YEAR:[${from || "1800"} TO ${to || Y}])`);
  return parts.filter(Boolean).join(" AND ");
}

function normalise(r){
  r = {...r, title: plain(dec(r.title)), abstractText: dec(r.abstractText)};
  const ptypes = new Set((((r.pubTypeList || {}).pubType) || []).map(t => String(t).toLowerCase()));
  const cc = ((((r.commentCorrectionList || {}).commentCorrection) || [])
    .map(x => String(x.type || "").toLowerCase()));
  const c = classify(r);
  const year = r.pubYear ? parseInt(r.pubYear, 10) : null;
  const authors = dec(r.authorString || "");
  const ftAll = ((r.fullTextUrlList && r.fullTextUrlList.fullTextUrl) || []);
  const ft = ftAll.filter(u => u.availability === "Open access" || u.availabilityCode === "OA");
  /* "Open access" and "there is a free copy" are different facts. A subscription paper can
     still have a legal free version, which is the one a student actually needs. */
  const freeAny = ftAll.find(u => /free|open access/i.test(u.availability || "")) || null;
  const absText = r.abstractText ? String(r.abstractText).replace(/<[^>]+>/g, "").trim() : "";
  return {
    id: (r.source || "X") + ":" + (r.id || slug(r.title || "")),
    title: (r.title || "Untitled").replace(/\.$/, ""),
    authors,
    journal: dec((r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || ""),
    year,
    doi: r.doi || "",
    pmid: r.pmid || "",
    pmcid: r.pmcid || "",
    citations: typeof r.citedByCount === "number" ? r.citedByCount : null,
    openAccess: r.isOpenAccess === "Y",
    abstract: absText,
    design: c.design, tier: c.tier, designSrc: c.src, designWhy: c.because || "",
    n: findN(r),
    url: r.doi ? "https://doi.org/" + r.doi
       : r.pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + r.pmid + "/"
       : "https://europepmc.org/article/" + (r.source || "MED") + "/" + (r.id || ""),
    epmc: "https://europepmc.org/article/" + (r.source || "MED") + "/" + (r.id || ""),
    fullText: ft.length ? ft[0].url : "",
    source: "med",
    /* Integrity signals. These have been in every response all along; the site simply
       never showed them. A retracted paper is the sharpest possible answer to "what
       kind of paper is this", and a preprint has not been peer reviewed at all. */
    retracted: ptypes.has("retracted publication") || cc.some(t => t.startsWith("retraction in")),
    concern: cc.some(t => t.includes("expression of concern")),
    erratum: cc.some(t => t.startsWith("erratum in") || t.startsWith("correction in")),
    preprint: ptypes.has("preprint") || r.source === "PPR",
    epmcId: r.id || "",
    epmcSource: r.source || "MED",
    /* Who paid. Not a verdict, but it belongs beside a design label. */
    grants: ((((r.grantsList || {}).grant) || []).map(g => dec(g.agency || "")).filter(Boolean))
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 4),
    freeFullText: (freeAny && freeAny.url) || "",
    /* A trial paper that names its registration can be checked against the registry. */
    nctIds: [...new Set(absText.match(/\bNCT\d{8}\b/g) || [])].slice(0, 3),
    /* Needed to build a real reference, not just to display a card. */
    journalAbbrev: dec((r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.isoabbreviation) || ""),
    volume: (r.journalInfo && r.journalInfo.volume) || "",
    issue: (r.journalInfo && r.journalInfo.issue) || "",
    pages: r.pageInfo || "",
    authorList: (((r.authorList || {}).author) || []).map(a => ({
      last: dec(a.lastName || ""),
      first: dec(a.firstName || ""),
      initials: a.initials || ""
    })).filter(a => a.last)
  };
}

async function fetchPage(cursor, signal){
  if (S.source === "psy")    return fetchOpenAlex(cursor, signal);
  if (S.source === "trials") return fetchTrials(cursor, signal);
  const p = new URLSearchParams({
    query: buildQuery(),
    format: "json",
    resultType: "core",
    pageSize: String(PAGE),
    cursorMark: cursor || "*"
  });
  const sort = SORTS.find(x => x.k === S.sort);
  if (sort && sort.q) p.set("sort", sort.q);

  let res;
  try {
    res = await fetch(API + "?" + p.toString(), {headers:{Accept:"application/json"}, signal});
  } catch (e) {
    if (aborted(e)) throw e;
    throw {kind: navigator.onLine === false ? "offline" : "network"};
  }
  if (res.status === 400) throw {kind:"badquery"};
  if (res.status === 429) throw {kind:"rate"};
  if (!res.ok) throw {kind:"server", status:res.status};
  let data;
  try { data = await res.json(); } catch(e) { throw {kind:"parse"}; }
  return {
    rows: ((data.resultList && data.resultList.result) || []).map(normalise),
    hitCount: data.hitCount || 0,
    next: data.nextCursorMark || null
  };
}

/* ══ Search flow ═══════════════════════════════════════════ */

/* Only the newest search may write to the state. `seq` numbers every search; a reply
   whose number is no longer current is dropped, and `inflight` lets a new search abort
   the request still on the wire rather than waiting for it. Without both, a slow first
   search can land after a fast second one and overwrite it. */
let seq = 0;
let inflight = null;
const aborted = e => !!e && (e.name === "AbortError" || e.kind === "abort");

async function runSearch(q, opts){
  const keepUrl = opts && opts.keepUrl;
  S.chainLabel = (opts && opts.chain) || "";
  q = (q || "").trim();
  if (!q) return;

  /* A newer search replaces the one in flight rather than being dropped, so changing a
     filter or retyping mid-search takes effect instead of being silently ignored. */
  if (inflight) inflight.abort();
  const ctrl = (inflight = new AbortController());
  const mine = ++seq;

  S.q = q; S.lastQ = q;
  S.busy = true; S.loadingMore = false; S.err = null; S.results = []; S.hitCount = 0;
  S.cursor = "*"; S.exhausted = false;
  go("search", {silent:true});
  render();

  try {
    const r = await fetchPage("*", ctrl.signal);
    if (mine !== seq) return;
    S.results = r.rows;
    S.hitCount = r.hitCount;
    S.cursor = r.next;
    S.exhausted = !r.next || r.rows.length < PAGE;
    addRecent(q);
  } catch (e) {
    if (mine !== seq || aborted(e)) return;
    S.err = e && e.kind ? e : {kind:"network"};
  }
  if (mine !== seq) return;
  inflight = null;
  S.busy = false;
  if (!keepUrl) pushUrl();
  render();
}

/* OpenAlex computes related works for everything it indexes, so a Europe PMC paper is
   reached by its DOI. Two round trips: the work itself, then its neighbours in one batch. */
async function similarTo(paper){
  const label = paper.title || "this paper";
  if (inflight) inflight.abort();
  const ctrl = (inflight = new AbortController());
  const mine = ++seq;
  S.open = null; S.confirmDel = false;
  S.busy = true; S.loadingMore = false; S.err = null; S.results = []; S.hitCount = 0;
  S.cursor = "*"; S.exhausted = true;
  S.chainLabel = `papers similar to ${label}`;
  go("search", {silent:true});
  render();
  try {
    const base = paper.openalexId
      ? "https://api.openalex.org/works/" + encodeURIComponent(paper.openalexId)
      : "https://api.openalex.org/works/doi:" + encodeURIComponent(paper.doi);
    const w = await fetch(base, {headers:{Accept:"application/json"}, signal:ctrl.signal}).then(r => {
      if (r.status === 404) throw {kind:"notfound"};
      if (!r.ok) throw {kind:"server", status:r.status};
      return r.json();
    });
    const ids = (w.related_works || []).map(u => String(u).split("/").pop()).filter(Boolean).slice(0, 20);
    if (mine !== seq) return;
    if (!ids.length) { inflight = null; S.busy = false; S.err = {kind:"empty"}; render(); return; }
    const q = new URLSearchParams({filter: "openalex_id:" + ids.join("|"), "per-page": String(ids.length)});
    const d = await fetch("https://api.openalex.org/works?" + q.toString(), {headers:{Accept:"application/json"}, signal:ctrl.signal})
      .then(r => { if (!r.ok) throw {kind:"server", status:r.status}; return r.json(); });
    if (mine !== seq) return;
    S.results = (d.results || []).map(normalisePsy);
    S.hitCount = S.results.length;
  } catch (e) {
    if (mine !== seq || aborted(e)) return;
    S.err = (e && e.kind) ? e : {kind:"network"};
  }
  if (mine !== seq) return;
  inflight = null;
  S.busy = false;
  render();
}

async function loadMore(){
  if (S.loadingMore || S.exhausted || !S.cursor) return;
  /* Registers as the request in flight without taking a new number, so a search started
     meanwhile aborts this page and its rows are never appended to the new results. */
  const ctrl = (inflight = new AbortController());
  const mine = seq;
  S.loadingMore = true; render();
  try {
    const r = await fetchPage(S.cursor, ctrl.signal);
    if (mine !== seq) return;
    const seen = new Set(S.results.map(x => x.id));
    S.results = S.results.concat(r.rows.filter(x => !seen.has(x.id)));
    S.cursor = r.next;
    S.exhausted = !r.next || r.rows.length < PAGE;
  } catch (e) {
    if (mine !== seq || aborted(e)) return;
    toast("Couldn't load more results.");
    S.exhausted = true;
  }
  if (mine !== seq) return;
  inflight = null;
  S.loadingMore = false; render();
}

function errCopy(e){
  switch (e.kind) {
    case "offline":  return {t:"You're offline", d:"Evidence Desk reads its sources live, so it needs a connection. Your reading list still works offline.", retry:true};
    case "network":  return {t:`Couldn't reach ${src().db}`, d:"The request didn't get through. This is usually temporary.", retry:true};
    case "badquery": return {t:`${src().db} couldn't read that query`, d:"An unmatched quote or bracket will do it. Try plain words, or check the search tips under How it ranks.", retry:false};
    case "rate":     return {t:"Too many searches too quickly", d:`${src().db} is rate-limiting this browser. Wait a few seconds and try again.`, retry:true};
    case "server":   return {t:`${src().db} returned an error`, d:`The service answered with status ${e.status}. It may be briefly down.`, retry:true};
    case "notfound": return {t:"That paper isn't in OpenAlex", d:"Similar papers are computed by OpenAlex, which does not index every record Europe PMC holds.", retry:false};
    case "parse":    return {t:"Unreadable response", d:`${src().db} answered with something this page couldn't parse.`, retry:true};
    default:         return {t:"Something went wrong", d:"The search didn't complete.", retry:true};
  }
}

/* ══ URL ═══════════════════════════════════════════ */

function pushUrl(){
  const p = new URLSearchParams();
  if (S.lastQ) p.set("q", S.lastQ);
  if (S.source !== "med") p.set("src", S.source);
  if (S.design !== "any") p.set("design", S.design);
  if (S.sort !== "relevance") p.set("sort", S.sort);
  if (S.openOnly) p.set("oa", "1");
  if (S.yearFrom) p.set("from", S.yearFrom);
  if (S.yearTo) p.set("to", S.yearTo);
  if (S.view !== "search") p.set("v", S.view);
  const url = location.pathname + (p.toString() ? "?" + p.toString() : "");
  history.pushState({}, "", url);
}
function readUrl(){
  const p = new URLSearchParams(location.search);
  S.q = p.get("q") || "";
  S.source = SOURCES[p.get("src")] ? p.get("src") : "med";
  S.design = DESIGN_FILTERS.some(d => d.k === p.get("design")) ? p.get("design") : "any";
  S.sort = SORTS.some(s => s.k === p.get("sort")) ? p.get("sort") : "relevance";
  S.openOnly = p.get("oa") === "1";
  S.yearFrom = /^\d{4}$/.test(p.get("from") || "") ? p.get("from") : "";
  S.yearTo = /^\d{4}$/.test(p.get("to") || "") ? p.get("to") : "";
  const v = p.get("v");
  S.view = (v === "list" || v === "about" || v === "privacy") ? v : "search";
}

/* ══ Shared rendering ═══════════════════════════════════════════ */

function chips(p){
  const c = [`<span class="chip" data-k="tier">${esc(p.design)}${p.designSrc === "inferred" ? ` <span class="chip-inf">inferred</span>` : ""}</span>`];
  if (p.retracted) c.push(`<span class="chip" data-k="retracted">${svg("i-alert")}Retracted</span>`);
  else if (p.concern) c.push(`<span class="chip" data-k="unposted">Expression of concern</span>`);
  if (p.erratum && !p.retracted) c.push(`<span class="chip">Corrected</span>`);
  if (p.preprint) c.push(`<span class="chip" data-k="preprint">Preprint · not peer reviewed</span>`);
  if (p.freeFullText) c.push(`<a class="chip" data-k="oa" href="${esc(p.freeFullText)}" target="_blank" rel="noopener">Free full text</a>`);
  else if (p.openAccess) c.push(`<span class="chip" data-k="oa">Open access</span>`);
  for (const nct of (p.nctIds || []))
    c.push(`<a class="chip" data-k="nct" href="https://clinicaltrials.gov/study/${esc(nct)}" target="_blank" rel="noopener">Registered ${esc(nct)}</a>`);
  if ((p.grants || []).length)
    c.push(`<span class="chip" data-k="fund" title="${esc(p.grants.join(", "))}">Funded by ${esc(p.grants[0])}${p.grants.length > 1 ? ` +${p.grants.length - 1}` : ""}</span>`);
  if (p.source === "trials") {
    c.push(`<span class="chip">${esc(p.trialStatus || "Status unknown")}</span>`);
    /* The whole reason this source exists: a finished trial that never reported. */
    if (p.trialDone) c.push(p.trialResults
      ? `<span class="chip" data-k="posted">Results posted</span>`
      : `<span class="chip" data-k="unposted">No results posted</span>`);
  }
  if (p.n) c.push(`<span class="chip" data-k="n">${p.source === "trials" ? "enrolled " : "n = "}${p.n.toLocaleString()}</span>`);
  for (const t of (p.tags || [])) c.push(`<span class="chip" data-k="tag">${esc(t)}</span>`);
  return `<div class="chips">${c.join("")}</div>`;
}
function meta(p){
  const b = [];
  if (p.authors) b.push(esc(p.authors.length > 90 ? p.authors.slice(0, 88) + "…" : p.authors));
  if (p.journal) b.push(`<i>${esc(p.journal)}</i>`);
  if (p.year) b.push(`<span class="num">${p.year}</span>`);
  /* Europe PMC counts only citations from inside its own index, so this runs well below
     Google Scholar and is 0 for anything recent. Labelled, not silently shown as "cites". */
  if (p.citations != null) b.push(`<span class="mono" title="Citations from within Europe PMC's index only — lower than Google Scholar or Scopus">${p.citations.toLocaleString()} EPMC cites</span>`);
  return `<div class="card-meta">${b.join('<span class="sep">·</span>')}</div>`;
}
function card(p, idx){
  const saved = S.list.has(p.id);
  const w = tierMeta(p.tier).w || "weak";
  const snip = p.abstract ? p.abstract.slice(0, 190).trim() + (p.abstract.length > 190 ? "…" : "") : "";
  return `<article class="card"${p.retracted ? ' data-retracted="1"' : ""} id="card-${esc(p.id)}">
    <div class="rail" data-w="${w}" aria-hidden="true"></div>
    <div class="card-body">
      <button class="card-title" data-open="${esc(p.id)}">${idx != null ? `<span class="mono" style="color:var(--faint)">${idx}.</span> ` : ""}${esc(p.title)}</button>
      ${meta(p)}
      ${snip ? `<p class="card-snip">${esc(snip)}</p>` : ""}
      ${chips(p)}
    </div>
    <div class="card-acts">
      ${saved ? `<span class="saved-tick">${svg("i-check")}Saved</span>`
              : `<button class="btn btn-sm" data-save="${esc(p.id)}">${svg("i-plus")}Save</button>`}
    </div>
  </article>`;
}

function plot(rows){
  const columns = cols();
  /* A row belongs on the grid if any column will take it — a missing year for the era
     columns, a status none of the trial columns match. */
  const placed = rows.filter(p => columns.some(c => c.test(p)));
  const ladder = tiers();
  /* Similar papers arrive from a different index and can carry a tier this ladder does not
     list. Append those rather than drop the papers. */
  const extra = [...new Set(placed.map(x => x.tier))]
    .filter(k => TIER[k] && !ladder.some(t => t.k === k))
    .sort((a, b) => TIER[a].rank - TIER[b].rank)
    .map(k => ({k, ...TIER[k]}));
  const full = ladder.concat(extra);
  const used = full.filter(t => placed.some(x => x.tier === t.k));
  const rows_t = used.length ? used : ladder.slice(0, 3);

  const counts = columns.map(c => placed.filter(p => c.test(p)).length);
  const colTracks = counts.map(c => c ? "minmax(0,1fr)" : "minmax(0,0.42fr)").join(" ");

  let g = `<div class="p-corner"></div>`;
  columns.forEach((e, i) => {
    g += `<div class="p-colhead" data-empty="${counts[i] ? 0 : 1}">
            <b>${esc(e.label)}</b><span>${counts[i] ? esc(e.sub) : "none"}</span></div>`;
  });

  for (const t of rows_t) {
    g += `<div class="p-rowhead ${t.w === "strong" ? "p-row-strong" : "p-row-weak"}">
            <b>${t.label}</b><span>${t.note}</span></div>`;
    for (const e of columns) {
      const cell = placed.filter(p => p.tier === t.k && e.test(p));
      g += `<div class="p-cell">` + (cell.length
        ? cell.map(p => {
            const lab = `${p.title.slice(0,70)} — ${p.design}${p.year ? `, ${p.year}` : ""}${p.n ? `, n = ${p.n}` : ""}${p.trialStatus ? `, ${p.trialStatus.toLowerCase()}` : ""}`;
            return `<button class="p-dot" data-w="${t.w}" data-saved="${S.list.has(p.id) ? 1 : 0}"
              data-jump="${esc(p.id)}" title="${esc(lab)}" aria-label="${esc(lab)}"><i></i></button>`;
          }).join("")
        : `<span class="p-empty">—</span>`) + `</div>`;
    }
  }

  const undated = rows.length - placed.length;

  /* The collapsed line has to carry the same reading as the grid: how much of this is
     strong evidence, what kinds dominate, and whether it is current. */
  const byTier = {};
  for (const p of placed) byTier[p.tier] = (byTier[p.tier] || 0) + 1;
  const topTiers = Object.keys(byTier)
    .sort((a, b) => byTier[b] - byTier[a]).slice(0, 3)
    .map(k => { const n = byTier[k], nm = tierMeta(k).noun || ["study","studies"];
                return `${n} ${n === 1 ? nm[0] : nm[1]}`; });
  const wCount = {strong:0, mid:0, weak:0};
  for (const p of placed) wCount[tierMeta(p.tier).w || "weak"]++;
  const live = columns.filter(c => placed.some(p => c.test(p)));
  const eraNote = live.length !== 1 ? ""
    : ` \u00b7 ${live[0].k === "new" ? `all since ${Y - 4}` : `all ${live[0].label.toLowerCase()}`}`;
  const summary = `<button class="plot-sum" type="button" data-plot-toggle aria-expanded="${S.plotOpen ? "true" : "false"}">
      <span class="sum-bar" aria-hidden="true">${["strong","mid","weak"]
        .map(w => wCount[w] ? `<i data-w="${w}" style="flex:${wCount[w]}"></i>` : "").join("")}</span>
      <span class="sum-text"><b>Evidence</b> ${esc(topTiers.join(", ") || "nothing placed")}${esc(eraNote)}</span>
      <svg class="sum-chev" aria-hidden="true"><use href="#i-chev"/></svg>
    </button>`;

  return `<section class="plot-card" data-open="${S.plotOpen ? 1 : 0}">
    ${summary}
    <div class="plot-full">
    <div class="plot-head">
      <span class="plot-title">What kind of evidence answers this</span>
      <button class="btn btn-sm btn-quiet" id="plot-png" type="button" style="margin-left:auto">${svg("i-down")}Image</button>
      <span class="plot-note">${placed.length} of ${rows.length} shown${undated ? ` · ${undated} undated` : ""}</span>
    </div>
    <div class="plot" style="--cols:${colTracks}" role="img" aria-label="${S.source === 'trials' ? 'Trials arranged by phase and reporting status' : 'Papers arranged by study design strength and publication era'}">${g}</div>
    <div class="plot-legend">
      <span class="lg" data-w="strong"><i></i>Strong design</span>
      <span class="lg" data-w="mid"><i></i>Observational</span>
      <span class="lg" data-w="weak"><i></i>Weak or indirect</span>
      <span class="lg" data-w="saved"><i></i>Saved</span>
      <span style="color:var(--faint)">Top rows carry most weight; right-hand column is most recent. Select a mark to jump to the paper.</span>
      <span style="flex-basis:100%;color:var(--faint)">This grid shows only the ${S.results.length} papers listed below, which are the first results by ${esc((SORTS.find(o => o.k === S.sort) || SORTS[0]).label.toLowerCase())}. That ordering favours recent work, so the grid is not a picture of the whole literature.</span>
    </div>
    </div>
  </section>`;
}

/* ══ Search view ═══════════════════════════════════════════ */

function renderSearch(){
  const hero = `<div>
    <div class="eyebrow">Search the medical literature</div>
    <h1 class="hero-h">Not just what the papers say — <em>what kind of papers they are.</em></h1>
    <p class="hero-sub">Every result is placed by study design and by how recent it is, so you can see at a glance whether a question is answered by current trials or by one old review. Literature from ${esc(src().db)}. ${
      (window.EDAuth && window.EDAuth.enabled)
        ? "No account needed; signing in syncs your reading list across devices."
        : "No account needed; your reading list stays in this browser."}</p>
  </div>

  <form id="search-form">
    <div class="bigfield">
      <label class="sr" for="q">Your search</label>
      <textarea id="q" rows="2" placeholder="${esc(src().placeholder)}" autocomplete="off" enterkeyhint="search">${esc(S.q)}</textarea>
      <button class="btn-go" type="submit" aria-busy="${S.busy ? "true" : "false"}">${S.busy ? "Searching" : "Search"}</button>
    </div>
    <div class="filters">
      <div class="seg" role="group" aria-label="Which literature to search">
        ${Object.keys(SOURCES).map(k =>
          `<button type="button" data-src="${k}" aria-pressed="${S.source === k}">${SOURCES[k].label}</button>`).join("")}
      </div>
      ${S.source === "med" ? `
      <label class="sr" for="f-design">Study design</label>
      <select class="sel" id="f-design">
        ${DESIGN_FILTERS.map(d => `<option value="${d.k}"${S.design === d.k ? " selected" : ""}>${d.label}</option>`).join("")}
      </select>` : ""}
      <label class="sr" for="f-sort">Sort by</label>
      <select class="sel" id="f-sort">
        ${SORTS.filter(o => !(S.source === "trials" && o.k === "cited")).map(o => `<option value="${o.k}"${S.sort === o.k ? " selected" : ""}>${o.label}</option>`).join("")}
      </select>
      <label class="sr" for="f-from">Published from</label>
      <input class="sel" id="f-from" style="width:88px" inputmode="numeric" maxlength="4" placeholder="From" value="${esc(S.yearFrom)}">
      <label class="sr" for="f-to">Published to</label>
      <input class="sel" id="f-to" style="width:78px" inputmode="numeric" maxlength="4" placeholder="To" value="${esc(S.yearTo)}">
      <label class="chk" data-on="${S.openOnly ? 1 : 0}">
        <input type="checkbox" id="f-oa" ${S.openOnly ? "checked" : ""}>
        <span class="tick">${svg("i-check")}</span>Open access only
      </label>
    </div>
  </form>`;

  const hint = S.hint
    ? `<div class="notice" role="status">${svg("i-alert")}<div>${esc(S.hint)}</div></div>`
    : "";

  const working = S.busy ? `<div class="working" role="status" aria-live="polite">
    <span class="spin" aria-hidden="true"></span>
    <div><div class="working-t">Searching Europe PMC</div>
    <div class="working-s">Reading publication types so each paper lands in the right row</div></div></div>` : "";

  let err = "";
  if (S.err) {
    const c = errCopy(S.err);
    err = `<div class="notice notice-bad">${svg("i-alert")}<div><b>${esc(c.t)}.</b> ${esc(c.d)}
      ${c.retry ? `<div style="margin-top:9px"><button class="btn btn-sm" data-redo="1">${svg("i-retry")}Try again</button></div>` : ""}
    </div></div>`;
  }

  const examples = (!S.results.length && !S.busy && !S.err) ? `<div class="examples">
    <div class="ex-head">Try one of these</div>
    <div class="ex-grid">${EXAMPLES.map(e =>
      `<button class="ex" data-ex="${esc(e.q)}"><span class="ex-tag">${esc(e.tag)}</span><span>${esc(e.q)}</span></button>`
    ).join("")}</div></div>` : "";

  let results = "";
  if (S.results.length) {
    const strong = S.results.filter(p => tierMeta(p.tier).w === "strong").length;
    results = `${S.chainLabel ? `<div class="banner">${svg("i-link")}
        <span class="grow">Showing <b>${esc(S.chainLabel.slice(0, 110))}</b></span>
        <button class="btn btn-sm" id="new-search" type="button">Clear</button></div>` : ""}
      <div class="list-head">
        <span class="list-h">${S.chainLabel ? "Related papers" : "Results"}</span>
        <span class="list-n">${S.results.length} shown of ${S.hitCount.toLocaleString()} · ${strong} at trial level or above</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" id="new-search">${svg("i-search")}New search</button>
        <button class="btn btn-sm" id="save-all">${svg("i-plus")}Save all shown</button>
      </div>
      ${plot(S.results)}
      <div class="list-head"><span class="list-h">Papers</span></div>
      <div class="cards">${S.results.map((p, i) => card(p, i + 1)).join("")}</div>
      ${S.exhausted
        ? `<p style="text-align:center;color:var(--faint);font-size:12.5px;margin-top:18px">
             ${S.results.length >= S.hitCount ? "That's everything Europe PMC has for this search." : "End of the results this page loaded."}</p>`
        : `<div style="display:flex;justify-content:center;margin-top:18px">
             <button class="btn" id="more" ${S.loadingMore ? "disabled" : ""}>${S.loadingMore ? "Loading…" : `Load ${PAGE} more`}</button>
           </div>`}`;
  } else if (!S.busy && !S.err && S.lastQ) {
    results = `<div class="empty">${svg("i-search")}<h3>Nothing matched that</h3>
      <p>Europe PMC found no records. Try fewer words, drop the filters, or name the population, the intervention and the outcome separately.</p></div>`;
  }

  $("view-search").innerHTML = hero + hint + working + err + examples + results;
}

/* ══ Reading list view ═══════════════════════════════════════════ */

function listRows(){
  let rows = [...S.list.values()];
  if (S.coll !== "all") rows = rows.filter(p => (p.collections || []).includes(S.coll));
  if (S.filter) {
    const t = S.filter.toLowerCase();
    rows = rows.filter(p =>
      (p.title||"").toLowerCase().includes(t) ||
      (p.authors||"").toLowerCase().includes(t) ||
      (p.journal||"").toLowerCase().includes(t) ||
      (p.note||"").toLowerCase().includes(t));
  }
  const rk = k => (TIER[k] || TIER.narrative).rank;
  rows.sort((a,b) => (rk(a.tier) - rk(b.tier)) || ((b.year||0) - (a.year||0)));
  return rows;
}

/* One line about where the list actually lives, which changes with the sign-in state. */
function syncBanner(){
  const A = window.EDAuth;
  if (!A || !A.enabled) return "";
  if (S.account.busy) {
    return `<div class="banner"><span class="spin" aria-hidden="true"></span>
      <span class="grow">Syncing your reading list…</span></div>`;
  }
  const u = S.account.user;
  if (u) {
    return `<div class="banner"><span class="sync-dot" aria-hidden="true"></span>
      <span class="grow"><b>Synced</b> to ${esc(u.email)} — your saved papers follow you to any device you sign in on.</span>
      ${S.account.note ? `<span style="flex-basis:100%;color:var(--muted)">${esc(S.account.note)}</span>` : ""}</div>`;
  }
  return `<div class="banner">${svg("i-alert")}
    <span class="grow"><b>Saved on this device only.</b> Sign in and your reading list follows you to another computer or phone.</span>
    <button class="btn btn-sm btn-primary" id="sign-in-open" type="button">Sign in</button></div>`;
}

function renderList(){
  const all = [...S.list.values()];
  const accounts = !!(window.EDAuth && window.EDAuth.enabled);
  if (!all.length) {
    $("view-list").innerHTML = `<div class="eyebrow">Reading list</div>
      ${syncBanner()}
    ${(() => {
      const bad = all.filter(x => x.retracted);
      if (!bad.length) return "";
      return `<div class="notice notice-bad">${svg("i-alert")}<div><b>${bad.length} saved paper${bad.length === 1 ? " has" : "s have"} been retracted.</b>
        A retracted paper should not be cited as evidence. ${bad.length === 1 ? "It is" : "They are"} struck through below,
        and marked in anything you export.</div></div>`;
    })()}
      <div class="empty">${svg("i-books")}<h3>Nothing saved yet</h3>
      <p>Save a paper from any search and it is kept with its study design and your own note.${
        accounts ? " Signed out, that means this browser only." : " It stays in this browser; clearing your browser data clears this."}</p>
      <button class="btn btn-primary" data-go="search">${svg("i-search")}Search for something</button></div>`;
    return;
  }
  const rows = listRows();
  $("view-list").innerHTML = `<div class="eyebrow">Reading list</div>
    <h1 class="hero-h" style="font-size:clamp(24px,3.4vw,31px)">${all.length} paper${all.length === 1 ? "" : "s"} saved</h1>
    <p class="hero-sub" style="margin-top:8px">${S.account.user
      ? "Synced to your account, and exportable whenever you want a copy of your own."
      : "Kept in this browser. Export them before you switch computer."}</p>
    ${syncBanner()}
    <div class="filters" style="padding-bottom:16px;border-bottom:1px solid var(--line-soft);margin-top:16px">
      <label class="sr" for="f-coll">Collection</label>
      <select class="sel" id="f-coll">
        <option value="all"${S.coll === "all" ? " selected" : ""}>All papers (${all.length})</option>
        ${collNames().map(c => {
          const n = all.filter(p => (p.collections || []).includes(c)).length;
          return `<option value="${esc(c)}"${S.coll === c ? " selected" : ""}>${esc(c)} (${n})</option>`;
        }).join("")}
      </select>
      ${S.coll === "all" ? "" : S.renaming
        ? `<form id="rename-form" style="display:flex;gap:6px">
             <label class="sr" for="rename-in">New name</label>
             <input class="sel" id="rename-in" style="width:150px" value="${esc(S.coll)}" maxlength="60">
             <button class="btn btn-sm btn-primary" type="submit">Save</button>
             <button class="btn btn-sm btn-quiet" id="rename-cancel" type="button">Cancel</button>
           </form>`
        : S.confirmColl
          ? `<span class="confirm" style="width:auto">${svg("i-alert")}<span>Delete the collection "${esc(S.coll)}"? The papers stay.</span>
               <button class="btn btn-sm btn-quiet" id="coll-del-no" type="button">Keep</button>
               <button class="btn btn-sm btn-danger" id="coll-del-yes" type="button">Delete</button></span>`
          : `<button class="btn btn-sm btn-quiet" id="coll-rename" type="button">Rename</button>
             <button class="btn btn-sm btn-quiet" id="coll-delete" type="button">Delete</button>`}
      <label class="sr" for="f-style">Reference style</label>
      <select class="sel" id="f-style">
        ${EDCITE().STYLES.map(st => `<option value="${st.k}"${S.citeStyle === st.k ? " selected" : ""}>${st.label}</option>`).join("")}
      </select>
      <button class="btn btn-sm btn-primary" id="export-docx" type="button" ${S.exporting ? "disabled" : ""}>
        ${svg("i-down")}${S.exporting ? "Building…" : "References"}</button>
      <button class="btn btn-sm" id="export-table" type="button" ${S.exporting ? "disabled" : ""}>
        ${svg("i-down")}Evidence table</button>
      <button class="btn btn-sm" data-export="bib">${svg("i-down")}BibTeX</button>
      <button class="btn btn-sm" data-export="ris">${svg("i-down")}RIS</button>
      <span style="flex:1"></span>
      ${S.confirmClear
        ? `<span class="confirm" style="width:auto">${svg("i-alert")}<span>Delete all ${all.length}?</span>
            <button class="btn btn-sm btn-quiet" id="clear-no">Keep</button>
            <button class="btn btn-sm btn-danger" id="clear-yes">Delete all</button></span>`
        : `<button class="btn btn-sm btn-danger" id="clear-ask">${svg("i-trash")}Clear list</button>`}
    </div>
    ${rows.length
      ? `<div class="list-head"><span class="list-n">${rows.length} shown</span></div>
         ${plot(rows)}
         <div class="cards" style="margin-top:20px">${rows.map(p => card(p, null)).join("")}</div>`
      : `<div class="empty">${svg("i-search")}<h3>No saved paper matches that filter</h3>
         <p>Clear the filter in the bar above to see the rest.</p></div>`}`;
}

/* ══ About view ═══════════════════════════════════════════ */

function renderAbout(){
  $("view-about").innerHTML = `<div class="eyebrow">How it ranks</div>
  <h1 class="hero-h" style="font-size:clamp(24px,3.4vw,31px)">Where each paper lands, and why</h1>
  <div class="prose" style="margin-top:20px">
    <p>Evidence Desk does not score papers or tell you what to conclude. It does one thing: it sorts what a search returns by <b>the kind of study each paper is</b>, because that is the first question worth asking about any clinical claim and the one a plain list of titles hides.</p>

    <h2>The rows</h2>
    <div class="ladder">
      ${tiers().map(t => `<div class="ladder-row" data-w="${t.w}"><i></i><b>${t.label}</b><span>${t.note}</span></div>`).join("")}
    </div>
    <p>Rows near the top aggregate or control away more of the things that mislead — chance, confounding, selection. That ordering is a rule of thumb, not a law: a large well-run cohort can be worth more than a small poor trial, and for questions about rare harms or prognosis the observational rows are where the real evidence lives. A preclinical result is not weak science, it just does not answer a question about people.</p>

    <h2>The columns</h2>
    <p>Papers are grouped by publication era, oldest on the left. This answers a question clinicians ask constantly and search engines rarely show: <i>is the good evidence here still current?</i> A topic whose only synthesis sits in the left column, with all the trials on the right, is a topic where the summary has not caught up with the primary literature.</p>

    <h2>Three sources, three ladders</h2>
    <p><b>Trials</b> searches <a href="https://clinicaltrials.gov" target="_blank" rel="noopener">ClinicalTrials.gov</a>
      and is not a literature search at all. It returns trials <i>as registered</i> — including ones
      that finished years ago and never published a word. That is publication bias, the largest
      distortion in any search of published papers, and it is invisible to every database that only
      holds things which got published. The rows are phases rather than study designs, and the
      columns ask the question worth asking of a registry: <b>did this ever report?</b> A topic whose
      Unreported column is fuller than its Reported one is a topic where the published literature is
      not the whole story.</p>
    <p>The switch under the search box changes both where the records come from and how they are
      ranked. <b>Medicine</b> searches <a href="https://europepmc.org" target="_blank" rel="noopener">Europe PMC</a>.
      <b>Psychology</b> searches <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a>,
      restricted to its psychology field, because Europe PMC covers psychiatry but very little
      cognitive, social or developmental work.</p>
    <p>The ladders differ because the fields do. A controlled lab experiment is central evidence in
      psychology and marginal in clinical medicine; qualitative work is real evidence in one and
      rare in the other; animal and in-vitro studies matter in medicine and hardly appear here.
      Relabelling one field's ladder for the other would misrepresent both, so each has its own.</p>
    <p><b>Psychology classification is weaker, and you should treat it that way.</b> OpenAlex carries
      no publication types, so on that side every design is read off the title and abstract and every
      card says <i>inferred</i>. On the medicine side most designs come from human indexers at the US
      National Library of Medicine. Same interface, genuinely different reliability.</p>

    <h2>Where the classification comes from</h2>
    <p>Most records carry publication types assigned by indexers at the US National Library of Medicine — <code>Randomized Controlled Trial</code>, <code>Meta-Analysis</code>, <code>Practice Guideline</code> and so on. Those are used directly and are reliable.</p>
    <p>Records with no such tag — newer entries, preprints, some non-MEDLINE journals — are classified by reading the title and abstract for the usual signals. Those are marked <span class="chip" data-k="tier">Design <span class="chip-inf">inferred</span></span> on the card. Treat an inferred label as a hint and check the paper. This is also why a record can read <i>Design unclear</i>: it is more honest than a confident guess.</p>

    <h2>What it does not do</h2>
    <ul>
      <li>It does not read the papers or summarise their findings. No AI is involved anywhere in this site.</li>
      <li>It does not judge quality within a row — no risk-of-bias scoring, no journal ranking.</li>
      <li>Citation counts are <b>Europe PMC's own</b>, counting only citations from publications
        inside its index. They run well below Google Scholar or Scopus — often by half — and read
        0 for anything published recently. Use them to compare papers with each other here, never
        as a paper's true citation count.</li>
      <li>It does not know whether a paper supports or contradicts your question. The rows tell you how much a paper <i>could</i> settle, not what it found.</li>
      <li>It is not a systematic review tool. One search on one database, ranked by relevance, is a starting point and not a reproducible search strategy.</li>
      <li>It is not medical advice, and nothing here should be used to make a decision about a patient or about yourself.</li>
    </ul>

    <h2>Search tips</h2>
    <ul>
      <li>Name the population, the intervention and the outcome: <code>adults heart failure dapagliflozin mortality</code> beats <code>SGLT2</code>.</li>
      <li>Europe PMC's own field syntax works here, so <code>AUTH:"Stavrou M"</code> or <code>JOURNAL:"Brain"</code> can be typed straight into the box.</li>
      <li>Unmatched quotes and brackets will make a search fail — that is the one thing that reliably breaks it.</li>
      <li>Every search is in the page's address, so you can bookmark a search or send it to someone.</li>
    </ul>

    <h2>Data and privacy</h2>
    <p>Literature comes from the <a href="https://europepmc.org" target="_blank" rel="noopener">Europe PMC</a> REST API, called straight from your browser. There is no server in between and no account, so nothing you do here is sent anywhere or logged.</p>
    <p>Two different things are stored, with deliberately different lifetimes. Your <b>reading list and notes</b> persist in this browser until you clear them — they are meant to be kept, which also means they do not follow you to another device, so export anything that matters. Your <b>recent searches</b> are held only for the current browsing session and disappear when you close the browser; there is a <b>Clear</b> control beside them in the sidebar for removing them sooner.</p>
    <p>On a shared or public computer, bear in mind that the reading list is deliberately persistent and the next person using that browser will see it. Clear it from the reading list page before you walk away, or use a private window.</p>
  </div>`;
}

/* ══ Sheet ═══════════════════════════════════════════ */

function renderSheet(){
  const root = $("sheet-root");
  if (S.signIn) { renderSignInSheet(); return; }
  if (!S.open) { root.innerHTML = ""; return; }
  const saved = S.list.get(S.open.id);
  const p = saved || S.open;
  const paras = (p.abstract || "").split(/\n{2,}/).filter(Boolean);

  const kv = [];
  if (p.journal) kv.push(`<dt>Journal</dt><dd>${esc(p.journal)}${p.year ? `, <span class="num">${p.year}</span>` : ""}</dd>`);
  const whyNote = p.designSrc === "metadata"
    ? `from the publication type${p.designWhy ? ` <i>${esc(p.designWhy)}</i>` : ""}`
    : p.designSrc === "registry" ? "from the registry"
    : p.designWhy ? `inferred from the phrase <i>${esc(p.designWhy)}</i>`
    : "no design signal found in the title or abstract";
  kv.push(`<dt>Design</dt><dd>${esc(p.design)} <span style="color:var(--faint);font-size:12px">${whyNote}</span></dd>`);
  if (p.n) kv.push(`<dt>Sample</dt><dd class="mono">n = ${p.n.toLocaleString()}</dd>`);
  if (p.citations != null) kv.push(`<dt>Cited</dt><dd class="mono">${p.citations.toLocaleString()} times</dd>`);
  if (p.doi) kv.push(`<dt>DOI</dt><dd class="mono"><a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">${esc(p.doi)}</a></dd>`);
  if (p.pmid) kv.push(`<dt>PMID</dt><dd class="mono"><a href="https://pubmed.ncbi.nlm.nih.gov/${esc(p.pmid)}/" target="_blank" rel="noopener">${esc(p.pmid)}</a></dd>`);

  root.innerHTML = `<div class="backdrop" id="bd"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Paper details">
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-top">
      <h2>Paper</h2>
      ${p.fullText ? `<a class="btn btn-sm" href="${esc(p.fullText)}" target="_blank" rel="noopener">${svg("i-link")}Full text</a>` : ""}
      <a class="btn btn-sm" href="${esc(p.epmc)}" target="_blank" rel="noopener">${svg("i-link")}Europe PMC</a>
      <button class="icon-btn" id="sheet-x" type="button" aria-label="Close">${svg("i-x")}</button>
    </div>
    <div class="sheet-body">
      <h3 class="sheet-title">${esc(p.title)}</h3>
      ${p.authors ? `<p class="sheet-authors">${esc(p.authors)}</p>` : ""}
      <dl class="kv">${kv.join("")}</dl>
      ${(p.epmcId || (p.authorList || []).length) ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
        ${p.epmcId ? `<button class="btn btn-sm" type="button" data-cited="${esc(p.epmcSource || "MED")}:${esc(p.epmcId)}">
          ${svg("i-search")}Papers citing this</button>` : ""}
        ${(p.authorList || []).length ? (() => {
            const a = p.authorList[0];
            const name = `${a.last}${a.initials ? " " + a.initials : ""}`;
            return `<button class="btn btn-sm" type="button" data-author="${esc(name)}">${svg("i-search")}More by ${esc(name)}</button>`;
          })() : ""}
        ${(p.doi || p.openalexId) ? `<button class="btn btn-sm" type="button" data-similar="1">${svg("i-link")}Similar papers</button>` : ""}
      </div>` : ""}
      ${saved ? `
        <div class="sh-head">Collections</div>
        <div class="chips">${(p.collections || []).length
          ? (p.collections || []).map(c => `<button class="tag-del" type="button" data-uncoll="${esc(c)}">${esc(c)}${svg("i-x")}</button>`).join("")
          : `<span style="font-size:13px;color:var(--faint)">Not in a collection yet</span>`}</div>
        <form class="tagrow" id="coll-form">
          <label class="sr" for="coll-in">Add to a collection</label>
          <input id="coll-in" list="coll-list" placeholder="Add to a collection, e.g. EPQ essay" autocomplete="off" maxlength="60">
          <datalist id="coll-list">${collNames().map(c => `<option value="${esc(c)}"></option>`).join("")}</datalist>
          <button class="btn btn-sm" type="submit">Add</button>
        </form>

        <div class="sh-head">Your note</div>
        <textarea class="note" id="note" placeholder="What this paper shows, what you doubt, how it connects to the rest.">${esc(p.note || "")}</textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:9px">
          <button class="btn btn-sm" id="note-save" type="button">Save note</button>
          <span id="note-state" style="font-size:12px;color:var(--faint)"></span>
        </div>` : ""}
      ${paras.length
        ? `<div class="sh-head">Abstract</div><div class="abstract">${paras.map(x => `<p>${esc(x)}</p>`).join("")}</div>`
        : `<div class="sh-head">Abstract</div><p style="color:var(--faint);font-size:13.5px">Europe PMC holds no abstract for this record.</p>`}
    </div>
    <div class="sheet-foot">
      ${S.confirmDel
        ? `<div class="confirm">${svg("i-alert")}<span class="grow">Remove this paper and its note from your reading list?</span>
             <button class="btn btn-sm btn-quiet" id="del-no" type="button">Keep</button>
             <button class="btn btn-sm btn-danger" id="del-yes" type="button">Remove</button></div>`
        : saved
          ? `<span class="saved-tick grow">${svg("i-check")}In your reading list</span>
             <button class="btn btn-sm btn-danger" id="del-ask" type="button">${svg("i-trash")}Remove</button>`
          : `<span class="grow" style="font-size:12.5px;color:var(--faint)">Not saved yet</span>
             <button class="btn btn-sm btn-primary" id="sheet-save" type="button">${svg("i-plus")}Save to reading list</button>`}
    </div>
  </div>`;
  setTimeout(() => { const b = document.querySelector("#sheet-x"); if (b) b.focus(); }, 10);
}

/* ══ Account UI ═══════════════════════════════════════════ */

function renderFoot(){
  const A = window.EDAuth;
  const u = S.account.user;
  let acct = "";
  if (A && A.enabled) {
    acct = u
      ? `<div class="acct">
           <span class="sync-dot" aria-hidden="true"></span>
           <span class="acct-who" title="${esc(u.email)}">${esc(u.email)}</span>
           <button class="btn btn-sm" id="sign-out" type="button">Sign out</button>
         </div>`
      : `<button class="btn btn-sm btn-primary" id="sign-in-open" type="button" style="width:100%">Sign in to sync</button>`;
  }
  $("side-foot").innerHTML = acct + `
    <p style="margin:${acct ? "10px" : "0"} 0 0">
      Literature from <a href="https://europepmc.org" target="_blank" rel="noopener">Europe PMC</a>.
      ${u ? "Your reading list syncs to your account."
          : "Your reading list and notes stay in this browser. Searches are sent to the databases."}
      ${A && A.enabled ? ` <button class="linkish" type="button" data-go="privacy">Privacy</button>.` : ""}
    </p>`;
}

function renderSignInSheet(){
  const A = window.EDAuth;
  const sent = S.account.sent;
  $("sheet-root").innerHTML = `<div class="backdrop" id="bd-signin"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Sign in">
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-top">
      <h2>Sign in</h2>
      <button class="icon-btn" id="signin-x" type="button" aria-label="Close">${svg("i-x")}</button>
    </div>
    <div class="sheet-body">
      ${sent ? `
        <h3 class="sheet-title">Check your email</h3>
        <p style="color:var(--muted);font-size:14px;margin-top:10px">A sign-in link is on its way to
          <b>${esc(sent)}</b>. Open it on this device and you're in — there's no password to remember.
          The link works once and expires after an hour.</p>
        <p class="fineprint">Nothing arrived? Look in spam, then
          <button class="linkish" type="button" id="signin-again">try a different address</button>.</p>
      ` : `
        <h3 class="sheet-title">Keep your reading list across devices</h3>
        <p style="color:var(--muted);font-size:14px;margin-top:10px">Signing in is optional. Without it
          everything stays in this browser, which is how the site works by default and is fine if you
          only ever use one computer.</p>
        ${A && A.googleEnabled ? `
          <button class="btn" id="google-in" type="button" style="width:100%;margin-top:18px">Continue with Google</button>
          <div class="or">or</div>`
        : `<div style="height:18px"></div>`}
        <form id="email-form">
          <label class="sr" for="email-in">Email address</label>
          <input class="signin-in" id="email-in" type="email" required autocomplete="email"
                 inputmode="email" placeholder="you@example.com">
          <button class="btn btn-primary" type="submit" style="width:100%;margin-top:9px"
            ${S.account.busy ? "disabled" : ""}>${S.account.busy ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
        <p class="fineprint">Signing in stores your email address and the papers you save, so they can
          be shown back to you on another device. Nothing else is collected, there is no tracking, and
          you can delete all of it whenever you like from the
          <button class="linkish" type="button" data-go="privacy">privacy page</button>.</p>
      `}
      ${S.account.note ? `<div class="notice" style="margin-top:16px">${svg("i-alert")}<div>${esc(S.account.note)}</div></div>` : ""}
    </div>
  </div>`;
  setTimeout(() => {
    const el = document.querySelector("#email-in") || document.querySelector("#signin-x");
    if (el) el.focus();
  }, 10);
}

function renderPrivacy(){
  const A = window.EDAuth;
  const on = !!(A && A.enabled);
  const u = S.account.user;
  const contact = (A && A.contactEmail) || "";

  $("view-privacy").innerHTML = `<div class="eyebrow">Privacy</div>
  <h1 class="hero-h" style="font-size:clamp(24px,3.4vw,31px)">What this site stores</h1>
  <div class="prose" style="margin-top:20px">
    <p>Evidence Desk is built to hold as little about you as it can. Searching needs no account, and
      without one nothing about you is stored anywhere except your own browser.</p>

    <h2>Without an account</h2>
    <ul>
      <li>Your <b>reading list and notes</b> stay in this browser until you clear them.</li>
      <li>Your <b>recent searches</b> are kept only for the current browsing session and are gone once
        you close the browser.</li>
      <li>Your <b>search terms are sent</b> to whichever database you are searching, because that
        is where the literature is. This site keeps no record of them.</li>
      <li>No analytics, no advertising, no third-party tracking, no cookies of our own.</li>
    </ul>
    <p>Everything your browser contacts while you use this site:</p>
    <ul>
      <li><a href="https://europepmc.org" target="_blank" rel="noopener">Europe PMC</a> receives your
        search terms on the Medicine tab.</li>
      <li><a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a> receives them on
        the Psychology tab, and whenever you ask for similar papers.</li>
      <li><a href="https://clinicaltrials.gov" target="_blank" rel="noopener">ClinicalTrials.gov</a>
        receives them on the Trials tab.</li>
      <li><b>Google Fonts</b> serves the typefaces, so it sees your IP address on every page load.</li>
      <li><b>unpkg</b>, or <b>jsDelivr</b> as a fallback, serves the library that builds Word files.
        It is fetched only when you export, never on a search.</li>
    </ul>

    <h2>With an account</h2>
    ${on ? `
    <p>Signing in is optional and exists for one reason: so your reading list follows you to another
      device. If you sign in, two things are stored on a server:</p>
    <ul>
      <li>Your <b>email address</b>, used only to identify you and send sign-in links. No marketing, ever.</li>
      <li>The <b>papers you save</b>, with your notes, tags and reading status.</li>
    </ul>
    <p>That is the whole list. Your searches are still not recorded. The data sits in a
      <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a> database, and a
      row-level security policy means the database itself refuses to return one person's rows to
      another — the separation is enforced where the data lives, not by the code in your browser.</p>
    <p>One thing worth stating plainly, because it is true of any site like this one: whoever runs it
      can see what is stored, saved papers and notes included, through the database's own
      administration tools. Row-level security separates people from each other, not from the
      operator. A reading list on a medical topic can reveal something about the person keeping it,
      so treat a note here the way you would anything else typed into someone else's website.</p>
    <p>Signing out clears the copy held on the device you were using, so a shared computer is not left
      showing your list to the next person.</p>
    ` : `<p>Accounts are not switched on for this site, so there is no server and nothing is stored
      away from your browser at all.</p>`}

    <h2>Deleting everything</h2>
    ${on ? `
    <p>You can clear the reading list on this device at any time from the reading list page. If you
      have an account, the button below removes your saved papers <i>and</i> the account itself,
      immediately and for good. Nothing is kept, and there is no recovery.</p>
    ${u ? (S.account.confirmWipe
      ? `<div class="confirm" style="margin:14px 0">${svg("i-alert")}
           <span class="grow">Delete your account and every paper saved to it? This cannot be undone.</span>
           <button class="btn btn-sm btn-quiet" id="wipe-no" type="button">Keep</button>
           <button class="btn btn-sm btn-danger" id="wipe-yes" type="button">Delete everything</button>
         </div>`
      : `<p><button class="btn btn-danger" id="wipe-ask" type="button">${svg("i-trash")}Delete my account and data</button></p>`)
      : `<p style="color:var(--faint)">Sign in to see the account deletion option.</p>`}
    ${contact ? `<p>You can also ask for a copy of your data, or have it deleted, by emailing
      <a href="mailto:${esc(contact)}">${esc(contact)}</a>.</p>` : ""}
    ` : `<p>Clear the reading list from the reading list page, or clear this site's data in your
      browser settings. There is nothing stored elsewhere to delete.</p>`}

    <h2>Children and medical decisions</h2>
    <p>This site is a literature search tool, not medical advice, and nothing here should be used to
      make a decision about anyone's care. It is not designed or intended for use by children.</p>
  </div>`;
}

/* ══ Shell ═══════════════════════════════════════════ */

function render(){
  $("view-search").hidden  = S.view !== "search";
  $("view-list").hidden    = S.view !== "list";
  $("view-about").hidden   = S.view !== "about";
  $("view-privacy").hidden = S.view !== "privacy";
  if (S.view === "search")  renderSearch();
  if (S.view === "list")    renderList();
  if (S.view === "about")   renderAbout();
  if (S.view === "privacy") renderPrivacy();

  document.querySelectorAll("[data-go]").forEach(b => {
    if (b.classList.contains("nav-item") || b.classList.contains("tab"))
      b.setAttribute("aria-current", b.dataset.go === S.view ? "page" : "false");
  });
  $("c-list").textContent = S.list.size || "";
  $("recent-block").innerHTML = `
    <div class="side-head-row">
      <span class="side-head">Recent searches</span>
      ${S.recent.length ? `<button type="button" id="clear-recent">Clear</button>` : ""}
    </div>
    ${S.recent.length
      ? `<nav class="recent" aria-label="Recent searches">${S.recent.map(q =>
          `<button type="button" data-ex="${esc(q)}" title="${esc(q)}">${esc(q)}</button>`).join("")}</nav>`
      : `<p class="recent-note">Searches you run appear here, and are cleared when you close the browser.</p>`}`;

  const f = $("q-list");
  if (f.value !== S.filter) f.value = S.filter;
  $("q-list-clear").hidden = !S.filter;
  renderFoot();
  renderSheet();
}

function go(view, opts){
  S.view = view;
  $("scroll").scrollTop = 0;
  if (!(opts && opts.silent)) { pushUrl(); render(); }
}

/* Back to a clean slate: no query, no results, filters at their defaults and a bare
   URL. The reading list and your theme survive, since neither belongs to one search. */
function home(){
  S.q = ""; S.lastQ = "";
  S.results = []; S.hitCount = 0; S.cursor = "*"; S.exhausted = false;
  S.busy = false; S.loadingMore = false; S.err = null;
  S.design = "any"; S.sort = "relevance"; S.openOnly = false;
  S.yearFrom = ""; S.yearTo = "";
  S.filter = ""; S.open = null; S.confirmDel = false; S.confirmClear = false;
  S.chainLabel = "";
  S.view = "search";
  history.pushState({}, "", location.pathname);
  $("scroll").scrollTop = 0;
  render();
}

/* ══ Export ═══════════════════════════════════════════ */

function downloadBlob(name, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* The docx library is fetched on the first export and cached by the browser after that,
   so the ~1.3 MB cost is paid once and never on a plain search. */
/* Drawn from the data rather than screenshotted from the page, so it is crisp at any size
   and needs no library. Colours are literal because CSS variables do not resolve inside an
   <img>, and a figure for a document wants the light palette anyway. */
function plotSvg(rows){
  const columns = cols();
  const placed = rows.filter(p => columns.some(c => c.test(p)));
  const ladder = tiers();
  const extra = [...new Set(placed.map(x => x.tier))]
    .filter(k => TIER[k] && !ladder.some(t => t.k === k))
    .sort((a, b) => TIER[a].rank - TIER[b].rank).map(k => ({k, ...TIER[k]}));
  const rowsT = ladder.concat(extra).filter(t => placed.some(x => x.tier === t.k));
  if (!rowsT.length) return null;

  const LAB = 160, COLW = 190, RH = 56, TOP = 86, PAD = 24;
  const W = LAB + COLW * columns.length + PAD * 2;
  const H = TOP + RH * rowsT.length + 64;
  const FILL = {strong:"#0F6B52", mid:"#8A5A00", weak:"#D9C9A8"};
  const esc2 = t => esc(t);
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, Helvetica, Arial, sans-serif">`;
  o += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  o += `<text x="${PAD}" y="30" font-size="15" font-weight="600" fill="#101418">What kind of evidence answers this</text>`;
  o += `<text x="${PAD}" y="50" font-size="11.5" fill="#5A6472">${esc2(S.lastQ || "")}</text>`;

  columns.forEach((c, i) => {
    const x = PAD + LAB + COLW * i + COLW / 2;
    o += `<text x="${x}" y="${TOP - 22}" font-size="11.5" font-weight="600" fill="#5A6472" text-anchor="middle">${esc2(c.label)}</text>`;
    o += `<text x="${x}" y="${TOP - 8}" font-size="10" fill="#8A94A3" text-anchor="middle">${esc2(c.sub)}</text>`;
  });
  o += `<line x1="${PAD}" y1="${TOP - 1}" x2="${W - PAD}" y2="${TOP - 1}" stroke="#D7DDE6"/>`;

  rowsT.forEach((t, ri) => {
    const y = TOP + RH * ri;
    o += `<text x="${PAD}" y="${y + RH / 2 - 2}" font-size="12" font-weight="600" fill="#101418">${esc2(t.label)}</text>`;
    o += `<text x="${PAD}" y="${y + RH / 2 + 13}" font-size="10" fill="#8A94A3">${esc2(t.note)}</text>`;
    o += `<line x1="${PAD}" y1="${y + RH}" x2="${W - PAD}" y2="${y + RH}" stroke="#E6EBF1"/>`;
    columns.forEach((c, ci) => {
      const cell = placed.filter(x => x.tier === t.k && c.test(x));
      const x0 = PAD + LAB + COLW * ci + 14;
      if (!cell.length) {
        o += `<text x="${x0 + COLW / 2 - 14}" y="${y + RH / 2 + 4}" font-size="11" fill="#D7DDE6" text-anchor="middle">—</text>`;
        return;
      }
      cell.slice(0, 18).forEach((pp, i) => {
        const cx = x0 + (i % 9) * 19 + 6;
        const cy = y + RH / 2 + (cell.length > 9 ? (i < 9 ? -9 : 9) : 0);
        o += `<circle cx="${cx}" cy="${cy}" r="6" fill="${FILL[t.w] || FILL.weak}"/>`;
      });
    });
  });

  o += `<line x1="${PAD + LAB - 10}" y1="${TOP - 1}" x2="${PAD + LAB - 10}" y2="${TOP + RH * rowsT.length}" stroke="#E6EBF1"/>`;
  o += `<text x="${PAD}" y="${H - 22}" font-size="10.5" fill="#8A94A3">${placed.length} of ${rows.length} records placed · higher rows carry more weight · Evidence Desk</text>`;
  o += `</svg>`;
  return o;
}

async function exportPlotImage(){
  if (!S.results.length) { toast("Run a search first."); return; }
  const svg = plotSvg(S.results);
  if (!svg) { toast("Nothing to draw for this search."); return; }
  const url = URL.createObjectURL(new Blob([svg], {type:"image/svg+xml;charset=utf-8"}));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("render")); img.src = url; });
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = img.width * scale; c.height = img.height * scale;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    await new Promise(res => c.toBlob(b => { if (b) downloadBlob(slug(S.lastQ || "evidence-plot") + ".png", b); res(); }, "image/png"));
    toast("Plot saved as an image.");
  } catch (e) {
    toast("Couldn't render the plot as an image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportTable(){
  const rows = listRows();
  if (!rows.length) { toast("Nothing to export with these filters."); return; }
  const cite = EDCITE();
  if (typeof cite.toTableDocxBlob !== "function") { toast("Export isn't available in this build."); return; }
  S.exporting = true; render();
  try {
    const name = S.coll === "all" ? "Evidence table" : S.coll;
    downloadBlob(slug(name) + "-table.docx", await cite.toTableDocxBlob(name, rows));
    toast(`Evidence table exported with ${rows.length} stud${rows.length === 1 ? "y" : "ies"}.`);
  } catch (e) {
    toast("Couldn't build the table — the export library didn't load.");
  }
  S.exporting = false; render();
}

async function exportDocx(){
  const rows = listRows();
  if (!rows.length) { toast("Nothing to export with these filters."); return; }
  const cite = EDCITE();
  if (typeof cite.toDocxBlob !== "function") { toast("Export isn't available in this build."); return; }
  S.exporting = true; render();
  try {
    const name = S.coll === "all" ? "References" : S.coll;
    const blob = await cite.toDocxBlob(name, rows, S.citeStyle);
    downloadBlob(slug(name) + ".docx", blob);
    toast(`${rows.length} reference${rows.length === 1 ? "" : "s"} exported.`);
  } catch (e) {
    toast("Couldn't build the Word file — the export library didn't load.");
  }
  S.exporting = false; render();
}

function download(name, text, mime){
  const blob = new Blob([text], {type: mime + ";charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function bibtex(rows){
  const clean = s => String(s || "").replace(/[{}]/g, "");
  return rows.map(p => {
    const first = (p.authors || "anon").split(/,| and /)[0].trim().split(/\s+/)[0].replace(/[^A-Za-z]/g, "") || "anon";
    const key = (first.toLowerCase() + (p.year || "") + slug((p.title || "").split(/\s+/)[0])).slice(0, 44);
    const f = [
      `  title = {${clean(p.title)}}`,
      p.authors ? `  author = {${clean(p.authors)}}` : null,
      p.journal ? `  journal = {${clean(p.journal)}}` : null,
      p.year ? `  year = {${p.year}}` : null,
      p.doi ? `  doi = {${clean(p.doi)}}` : null,
      p.pmid ? `  note = {PMID: ${clean(p.pmid)}}` : null,
      `  keywords = {${clean(p.design)}}`
    ].filter(Boolean).join(",\n");
    return `@article{${key},\n${f}\n}`;
  }).join("\n\n") + "\n";
}
function ris(rows){
  return rows.map(p => {
    const l = ["TY  - JOUR"];
    for (const a of (p.authors || "").split(/,\s*/).filter(Boolean).slice(0, 40)) l.push("AU  - " + a);
    l.push("TI  - " + (p.title || ""));
    if (p.journal) l.push("JO  - " + p.journal);
    if (p.year) l.push("PY  - " + p.year);
    if (p.doi) l.push("DO  - " + p.doi);
    if (p.pmid) l.push("AN  - " + p.pmid);
    if (p.abstract) l.push("AB  - " + p.abstract.replace(/\s+/g, " "));
    l.push("KW  - " + p.design);
    if (p.note) l.push("N1  - " + p.note.replace(/\s+/g, " "));
    l.push("ER  - ");
    return l.join("\n");
  }).join("\n\n") + "\n";
}

/* ══ Events ═══════════════════════════════════════════ */

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-author],[data-similar],[data-cited],[data-uncoll],[data-plot-toggle],[data-src],[data-go],[data-ex],[data-open],[data-save],[data-jump],[data-redo],[data-export],#more,#save-all,#sheet-x,#bd,#sheet-save,#del-ask,#del-no,#del-yes,#note-save,#clear-ask,#clear-no,#clear-yes,#q-list-clear,#home-side,#home-top,#new-search,#clear-recent,#sign-in-open,#sign-out,#signin-x,#bd-signin,#google-in,#signin-again,#wipe-ask,#wipe-no,#wipe-yes,#export-docx,#export-table,#plot-png,#coll-rename,#coll-delete,#coll-del-no,#coll-del-yes,#rename-cancel");
  if (!t) return;

  if (t.id === "home-side" || t.id === "home-top" || t.id === "new-search") { home(); return; }
  if (t.id === "clear-recent") { clearRecent(); return; }
  if (t.id === "sign-in-open") { S.signIn = true; S.account.sent = ""; S.account.note = ""; renderSheet(); return; }
  if (t.id === "signin-x" || t.id === "bd-signin") { S.signIn = false; S.account.note = ""; renderSheet(); return; }
  if (t.id === "signin-again") { S.account.sent = ""; S.account.note = ""; renderSheet(); return; }
  if (t.id === "google-in") { signInGoogle(); return; }
  if (t.id === "sign-out") { if (window.EDAuth) window.EDAuth.signOut(); return; }
  if (t.id === "wipe-ask") { S.account.confirmWipe = true; render(); return; }
  if (t.id === "wipe-no")  { S.account.confirmWipe = false; render(); return; }
  if (t.id === "wipe-yes") { deleteAccount(); return; }
  if (t.hasAttribute("data-plot-toggle")) { S.plotOpen = !S.plotOpen; render(); return; }
  if (t.dataset.uncoll && S.open) {
    const cur = S.list.get(S.open.id);
    if (cur) { setCollections(S.open.id, (cur.collections || []).filter(c => c !== t.dataset.uncoll));
               S.open = {...S.list.get(S.open.id)}; renderSheet(); }
    return;
  }
  if (t.id === "coll-rename")  { S.renaming = true;  S.confirmColl = false; render(); return; }
  if (t.id === "rename-cancel"){ S.renaming = false; render(); return; }
  if (t.id === "coll-delete")  { S.confirmColl = true; S.renaming = false; render(); return; }
  if (t.id === "coll-del-no")  { S.confirmColl = false; render(); return; }
  if (t.id === "coll-del-yes") { deleteColl(S.coll); S.confirmColl = false; return; }
  if (t.id === "export-docx")  { exportDocx(); return; }
  if (t.id === "export-table") { exportTable(); return; }
  if (t.id === "plot-png")     { exportPlotImage(); return; }
  if (t.dataset.author) {
    const name = t.dataset.author;
    S.open = null; S.confirmDel = false;
    S.q = S.source === "psy" ? `"${name}"` : `AUTH:"${name}"`;
    runSearch(S.q, {chain: `everything by ${name}`});
    return;
  }
  if (t.dataset.similar && S.open) { similarTo(S.open); return; }
  if (t.dataset.cited) {
    const [srcCode, id] = t.dataset.cited.split(":");
    const label = (S.open && S.open.title) || "this paper";
    S.open = null; S.confirmDel = false;
    S.source = "med";
    S.q = `CITES:${id}_${srcCode}`;
    runSearch(S.q, {chain: `papers that cite ${label}`});
    return;
  }
  if (t.dataset.src) {
    if (S.source === t.dataset.src) return;
    S.source = t.dataset.src;
    S.design = "any";              /* Europe PMC's design filter has no OpenAlex equivalent. */
    S.results = []; S.hitCount = 0; S.cursor = "*"; S.exhausted = false; S.err = null;
    if (S.lastQ) runSearch(S.lastQ); else { pushUrl(); render(); }
    return;
  }
  if (t.dataset.redo) { runSearch(S.lastQ || S.q); return; }
  if (t.dataset.go)   { go(t.dataset.go); return; }
  if (t.dataset.ex)   { S.q = t.dataset.ex; runSearch(S.q); return; }

  if (t.dataset.open) {
    const p = S.list.get(t.dataset.open) || S.results.find(x => x.id === t.dataset.open);
    if (p) { S.open = p; S.confirmDel = false; renderSheet(); }
    return;
  }
  if (t.dataset.save) {
    const p = S.results.find(x => x.id === t.dataset.save);
    if (p && !S.list.has(p.id)) {
      const item = {...p, note:"", savedAt:new Date().toISOString(), fromQuery:S.lastQ};
      S.list.set(p.id, item);
      persist({type:"upsert", item}); render(); toast("Saved to reading list.");
    }
    return;
  }
  if (t.dataset.jump) {
    const c = document.getElementById("card-" + t.dataset.jump);
    if (c) {
      c.scrollIntoView({block:"center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
      c.classList.add("flash");
      setTimeout(() => c.classList.remove("flash"), 1400);
    }
    return;
  }
  if (t.dataset.export) {
    const rows = listRows();
    if (!rows.length) { toast("Nothing to export."); return; }
    if (t.dataset.export === "bib") download("evidence-desk.bib", bibtex(rows), "application/x-bibtex");
    else download("evidence-desk.ris", ris(rows), "application/x-research-info-systems");
    toast(`${rows.length} record${rows.length === 1 ? "" : "s"} exported.`);
    return;
  }

  switch (t.id) {
    case "more": loadMore(); break;
    case "save-all": {
      const added = [];
      for (const p of S.results) if (!S.list.has(p.id)) {
        const item = {...p, note:"", savedAt:new Date().toISOString(), fromQuery:S.lastQ};
        S.list.set(p.id, item); added.push(item);
      }
      if (added.length) { persist({type:"bulk", items:added}); render(); }
      toast(added.length ? `${added.length} paper${added.length === 1 ? "" : "s"} saved.` : "Those are all saved already.");
      break;
    }
    case "sheet-x": case "bd": S.open = null; S.confirmDel = false; renderSheet(); break;
    case "sheet-save": {
      const p = S.open;
      const item = {...p, note:"", savedAt:new Date().toISOString(), fromQuery:S.lastQ};
      S.list.set(p.id, item);
      persist({type:"upsert", item}); render(); toast("Saved to reading list.");
      break;
    }
    case "del-ask": S.confirmDel = true; renderSheet(); break;
    case "del-no":  S.confirmDel = false; renderSheet(); break;
    case "del-yes": {
      const gone = S.open.id;
      S.list.delete(gone);
      persist({type:"delete", id:gone});
      S.open = null; S.confirmDel = false; render(); toast("Removed.");
      break;
    }
    case "note-save": {
      const el = document.querySelector("#note");
      const cur = S.list.get(S.open.id);
      if (cur && el) {
        cur.note = el.value;
        persist({type:"upsert", item:cur});
        const st = document.querySelector("#note-state");
        if (st) { st.textContent = "Note saved"; setTimeout(() => { if (st) st.textContent = ""; }, 2000); }
      }
      break;
    }
    case "clear-ask": S.confirmClear = true; render(); break;
    case "clear-no":  S.confirmClear = false; render(); break;
    case "clear-yes": {
      S.list.clear();
      persist({type:"clear"});
      S.confirmClear = false; render(); toast("Reading list cleared.");
      break;
    }
    case "q-list-clear": S.filter = ""; render(); $("q-list").focus(); break;
  }
});

document.addEventListener("submit", (ev) => {
  if (ev.target.id === "coll-form") {
    ev.preventDefault();
    const el = document.querySelector("#coll-in");
    const v = clean(el && el.value);
    if (!v || !S.open) return;
    const cur = S.list.get(S.open.id);
    if (!cur) return;
    rememberColl(v);
    setCollections(S.open.id, [...new Set([...(cur.collections || []), v])]);
    S.open = {...S.list.get(S.open.id)};
    renderSheet();
    return;
  }
  if (ev.target.id === "rename-form") {
    ev.preventDefault();
    const el = document.querySelector("#rename-in");
    renameColl(S.coll, el ? el.value : "");
    S.renaming = false;
    render();
    return;
  }
  if (ev.target.id === "email-form") {
    ev.preventDefault();
    const el = document.querySelector("#email-in");
    const v = ((el && el.value) || "").trim();
    if (v) sendMagicLink(v);
    return;
  }
  if (ev.target.id === "search-form") {
    ev.preventDefault();
    const el = $("q");
    const typed = ((el && el.value) || "").trim();
    if (!typed) {
      S.hint = "Type a question first, or paste a DOI or PMID. The examples below are a starting point.";
      render();
      if ($("q")) $("q").focus();
      return;
    }
    S.hint = "";
    runSearch(typed);
  }
});

document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.id === "q") { S.q = el.value; if (S.hint && el.value.trim()) { S.hint = ""; render(); } }
  if (el.id === "f-from") S.yearFrom = el.value.replace(/\D/g, "").slice(0, 4);
  if (el.id === "f-to")   S.yearTo   = el.value.replace(/\D/g, "").slice(0, 4);
  if (el.id === "q-list") {
    S.filter = el.value;
    if (S.view !== "list") go("list"); else render();
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "f-coll")  { S.coll = ev.target.value; S.renaming = false; S.confirmColl = false; render(); return; }
  if (ev.target.id === "f-style") { S.citeStyle = ev.target.value; render(); return; }
  const el = ev.target;
  if (el.id === "f-design") { S.design = el.value; if (S.lastQ) runSearch(S.lastQ); }
  if (el.id === "f-sort")   { S.sort = el.value;   if (S.lastQ) runSearch(S.lastQ); }
  if (el.id === "f-oa") {
    S.openOnly = el.checked;
    const w = el.closest(".chk"); if (w) w.dataset.on = el.checked ? 1 : 0;
    if (S.lastQ) runSearch(S.lastQ);
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && S.signIn) { ev.preventDefault(); S.signIn = false; S.account.note = ""; renderSheet(); return; }
  if (ev.key === "Escape" && S.open) { ev.preventDefault(); S.open = null; S.confirmDel = false; renderSheet(); }
  if (ev.key === "Enter" && !ev.shiftKey && ev.target.id === "q") {
    ev.preventDefault(); runSearch(ev.target.value);
  }
});

window.addEventListener("popstate", () => {
  readUrl();
  if (S.q && S.q !== S.lastQ) runSearch(S.q, {keepUrl:true});
  else render();
});

/* ══ Start ═══════════════════════════════════════════ */

loadList();
readUrl();
render();
if (S.q) runSearch(S.q, {keepUrl:true});

/* Accounts, when configured. The page is already rendered and usable by this point;
   signing in only ever adds to it. */
if (window.EDAuth && window.EDAuth.enabled) {
  window.EDAuth.onChange(onAuthChange);
  window.EDAuth.ready.then(ok => { if (ok) onAuthChange(); });
}

})();
