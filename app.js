/* Evidence Desk — public edition
 * Literature from Europe PMC (https://europepmc.org). No account, no server, no tracking.
 * Reading list and notes persist in localStorage; recent searches are session-scoped.
 */
(() => {
"use strict";

/* ══ Constants ═══════════════════════════════════════════ */

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const PAGE = 25;
const Y = new Date().getFullYear();

const TIERS = [
  {k:"synthesis",   label:"Synthesis",   note:"Meta-analysis · systematic review", w:"strong"},
  {k:"guideline",   label:"Guideline",   note:"Practice guideline · consensus",    w:"strong"},
  {k:"trial",       label:"Trial",       note:"Randomised · controlled",           w:"strong"},
  {k:"cohort",      label:"Observational", note:"Cohort · case–control · survey",  w:"mid"},
  {k:"case",        label:"Case",        note:"Case report · series",              w:"weak"},
  {k:"preclinical", label:"Preclinical", note:"Animal · in vitro · modelling",     w:"weak"},
  {k:"narrative",   label:"Narrative",   note:"Review · comment · editorial",      w:"weak"}
];
const TIER = Object.fromEntries(TIERS.map(t => [t.k, t]));

const ERAS = [
  {k:"old", label:"Before " + (Y-14), sub:"Older work",      test:y => y <  Y-14},
  {k:"mid", label:(Y-14) + "–" + (Y-5), sub:"Established",   test:y => y >= Y-14 && y <= Y-5},
  {k:"new", label:(Y-4) + "–now",     sub:"Current",         test:y => y >= Y-4}
];

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

const LS = {list:"ed-reading-list", recent:"ed-recent", theme:"ed-theme"};

/* ══ State ═══════════════════════════════════════════ */

const S = {
  view:"search",
  q:"", lastQ:"",
  design:"any", sort:"relevance", openOnly:false, yearFrom:"", yearTo:"",
  busy:false, loadingMore:false,
  results:[], hitCount:0, cursor:"*", exhausted:false,
  err:null,
  list:new Map(), recent:[],
  filter:"",
  open:null, confirmDel:false, confirmClear:false
};

/* ══ Helpers ═══════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s)
  .replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const svg = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

/* Europe PMC stores HTML entities in titles and abstracts ("Prevention &amp; Rehabilitation").
   Decode once on the way in; everything is escaped again on the way out. A detached textarea
   parses its contents as raw text, so nothing here can execute. */
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
  const has = (...xs) => xs.some(x => types.has(x));
  const txt = ((r.title || "") + " " + (r.abstractText || "")).toLowerCase();
  const re = x => x.test(txt);

  if (has("meta-analysis"))      return {design:"Meta-analysis",   tier:"synthesis", src:"metadata"};
  if (has("systematic review"))  return {design:"Systematic review", tier:"synthesis", src:"metadata"};
  if (has("practice guideline","guideline","consensus development conference"))
                                 return {design:"Guideline",       tier:"guideline", src:"metadata"};
  if (has("consensus statement")) return {design:"Consensus statement", tier:"guideline", src:"metadata"};
  if (has("randomized controlled trial"))
                                 return {design:"Randomised controlled trial", tier:"trial", src:"metadata"};
  for (const t of types) {
    if (t.startsWith("clinical trial") || t === "pragmatic clinical trial" || t === "controlled clinical trial")
      return {design:"Clinical trial", tier:"trial", src:"metadata"};
  }
  if (has("case reports"))       return {design:"Case report",     tier:"case", src:"metadata"};
  if (has("observational study")) return {design:"Observational study", tier:"cohort", src:"metadata"};

  /* No design in the metadata — read the abstract instead. */
  const humanTrial = re(/randomly assigned|randomised|randomized|placebo-controlled|double-blind|participants were/);
  const animal = re(/\bmice\b|\bmouse\b|murine|\brats?\b|in vitro|cell lines?|ipsc|non-human primate|macaca|zebrafish|knockout|transgenic|preclinical|organoid/);
  if (animal && !humanTrial) return {design: re(/in vitro|cell lines?|ipsc|organoid/) ? "In vitro" : "Animal study", tier:"preclinical", src:"inferred"};
  if (humanTrial)            return {design:"Trial",            tier:"trial",  src:"inferred"};
  if (re(/\bcohort\b|prospectively followed|longitudinal|years of follow-up/))
                             return {design:"Cohort study",     tier:"cohort", src:"inferred"};
  if (re(/case-control|case–control/))
                             return {design:"Case–control",     tier:"cohort", src:"inferred"};
  if (re(/cross-sectional|prevalence survey|registry analysis|questionnaire survey/))
                             return {design:"Cross-sectional",  tier:"cohort", src:"inferred"};
  if (re(/we report a case|index patient|we present a (patient|case)/))
                             return {design:"Case report",      tier:"case",   src:"inferred"};
  if (re(/simulation|mathematical model|computational model|in silico/))
                             return {design:"Modelling",        tier:"preclinical", src:"inferred"};
  if (has("review","review-article")) return {design:"Review",  tier:"narrative", src:"metadata"};
  if (has("editorial","comment","letter","news","published erratum"))
                             return {design:"Comment",          tier:"narrative", src:"metadata"};
  if (re(/this review|we review|this article reviews|overview of/))
                             return {design:"Review",           tier:"narrative", src:"inferred"};
  return {design:"Design unclear", tier:"narrative", src:"inferred"};
}

function findN(r){
  const t = (r.abstractText || "");
  const m = t.match(/\bn\s*=\s*([\d,]{1,9})/i)
         || t.match(/([\d,]{2,9})\s+(?:patients|participants|subjects|individuals|adults|children|women|men)\b/i);
  if (!m) return null;
  const v = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(v) && v > 1 && v < 1e8 ? v : null;
}

/* ══ Europe PMC ═══════════════════════════════════════════ */

function buildQuery(){
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
  r = {...r, title: dec(r.title), abstractText: dec(r.abstractText)};
  const c = classify(r);
  const year = r.pubYear ? parseInt(r.pubYear, 10) : null;
  const authors = dec(r.authorString || "");
  const ft = ((r.fullTextUrlList && r.fullTextUrlList.fullTextUrl) || [])
    .filter(u => u.availability === "Open access" || u.availabilityCode === "OA");
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
    abstract: r.abstractText ? String(r.abstractText).replace(/<[^>]+>/g, "").trim() : "",
    design: c.design, tier: c.tier, designSrc: c.src,
    n: findN(r),
    url: r.doi ? "https://doi.org/" + r.doi
       : r.pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + r.pmid + "/"
       : "https://europepmc.org/article/" + (r.source || "MED") + "/" + (r.id || ""),
    epmc: "https://europepmc.org/article/" + (r.source || "MED") + "/" + (r.id || ""),
    fullText: ft.length ? ft[0].url : ""
  };
}

async function fetchPage(cursor){
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
    res = await fetch(API + "?" + p.toString(), {headers:{Accept:"application/json"}});
  } catch (e) {
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

async function runSearch(q, opts){
  const keepUrl = opts && opts.keepUrl;
  q = (q || "").trim();
  if (!q || S.busy) return;
  S.q = q; S.lastQ = q;
  S.busy = true; S.err = null; S.results = []; S.hitCount = 0;
  S.cursor = "*"; S.exhausted = false;
  go("search", {silent:true});
  render();

  try {
    const r = await fetchPage("*");
    S.results = r.rows;
    S.hitCount = r.hitCount;
    S.cursor = r.next;
    S.exhausted = !r.next || r.rows.length < PAGE;
    addRecent(q);
  } catch (e) {
    S.err = e && e.kind ? e : {kind:"network"};
  }
  S.busy = false;
  if (!keepUrl) pushUrl();
  render();
}

async function loadMore(){
  if (S.loadingMore || S.exhausted || !S.cursor) return;
  S.loadingMore = true; render();
  try {
    const r = await fetchPage(S.cursor);
    const seen = new Set(S.results.map(x => x.id));
    S.results = S.results.concat(r.rows.filter(x => !seen.has(x.id)));
    S.cursor = r.next;
    S.exhausted = !r.next || r.rows.length < PAGE;
  } catch (e) {
    toast("Couldn't load more results.");
    S.exhausted = true;
  }
  S.loadingMore = false; render();
}

function errCopy(e){
  switch (e.kind) {
    case "offline":  return {t:"You're offline", d:"Evidence Desk reads Europe PMC live, so it needs a connection. Your reading list still works offline.", retry:true};
    case "network":  return {t:"Couldn't reach Europe PMC", d:"The request didn't get through. This is usually temporary.", retry:true};
    case "badquery": return {t:"Europe PMC couldn't read that query", d:"An unmatched quote or bracket will do it. Try plain words, or check the search tips under How it ranks.", retry:false};
    case "rate":     return {t:"Too many searches too quickly", d:"Europe PMC is rate-limiting this browser. Wait a few seconds and try again.", retry:true};
    case "server":   return {t:"Europe PMC returned an error", d:`The service answered with status ${e.status}. It may be briefly down — europepmc.org will say.`, retry:true};
    case "parse":    return {t:"Unreadable response", d:"Europe PMC answered with something this page couldn't parse.", retry:true};
    default:         return {t:"Something went wrong", d:"The search didn't complete.", retry:true};
  }
}

/* ══ URL ═══════════════════════════════════════════ */

function pushUrl(){
  const p = new URLSearchParams();
  if (S.lastQ) p.set("q", S.lastQ);
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
  S.design = DESIGN_FILTERS.some(d => d.k === p.get("design")) ? p.get("design") : "any";
  S.sort = SORTS.some(s => s.k === p.get("sort")) ? p.get("sort") : "relevance";
  S.openOnly = p.get("oa") === "1";
  S.yearFrom = /^\d{4}$/.test(p.get("from") || "") ? p.get("from") : "";
  S.yearTo = /^\d{4}$/.test(p.get("to") || "") ? p.get("to") : "";
  const v = p.get("v");
  S.view = (v === "list" || v === "about") ? v : "search";
}

/* ══ Shared rendering ═══════════════════════════════════════════ */

function chips(p){
  const c = [`<span class="chip" data-k="tier">${esc(p.design)}${p.designSrc === "inferred" ? ` <span class="chip-inf">inferred</span>` : ""}</span>`];
  if (p.n) c.push(`<span class="chip" data-k="n">n = ${p.n.toLocaleString()}</span>`);
  if (p.openAccess) c.push(`<span class="chip" data-k="oa">Open access</span>`);
  for (const t of (p.tags || [])) c.push(`<span class="chip" data-k="tag">${esc(t)}</span>`);
  return `<div class="chips">${c.join("")}</div>`;
}
function meta(p){
  const b = [];
  if (p.authors) b.push(esc(p.authors.length > 90 ? p.authors.slice(0, 88) + "…" : p.authors));
  if (p.journal) b.push(`<i>${esc(p.journal)}</i>`);
  if (p.year) b.push(`<span class="num">${p.year}</span>`);
  if (p.citations != null) b.push(`<span class="mono">${p.citations.toLocaleString()} cites</span>`);
  return `<div class="card-meta">${b.join('<span class="sep">·</span>')}</div>`;
}
function card(p, idx){
  const saved = S.list.has(p.id);
  const w = TIER[p.tier] ? TIER[p.tier].w : "weak";
  const snip = p.abstract ? p.abstract.slice(0, 190).trim() + (p.abstract.length > 190 ? "…" : "") : "";
  return `<article class="card" id="card-${esc(p.id)}">
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
  const placed = rows.filter(p => p.year);
  const used = TIERS.filter(t => placed.some(p => p.tier === t.k));
  const tiers = used.length ? used : TIERS.slice(0, 3);

  const counts = ERAS.map(e => placed.filter(p => e.test(p.year)).length);
  const cols = counts.map(c => c ? "minmax(0,1fr)" : "minmax(0,0.42fr)").join(" ");

  let g = `<div class="p-corner"></div>`;
  ERAS.forEach((e, i) => {
    g += `<div class="p-colhead" data-empty="${counts[i] ? 0 : 1}">
            <b>${esc(e.label)}</b><span>${counts[i] ? esc(e.sub) : "none"}</span></div>`;
  });

  for (const t of tiers) {
    g += `<div class="p-rowhead ${t.w === "strong" ? "p-row-strong" : "p-row-weak"}">
            <b>${t.label}</b><span>${t.note}</span></div>`;
    for (const e of ERAS) {
      const cell = placed.filter(p => p.tier === t.k && e.test(p.year));
      g += `<div class="p-cell">` + (cell.length
        ? cell.map(p => {
            const lab = `${p.title.slice(0,70)} — ${p.design}, ${p.year}${p.n ? `, n = ${p.n}` : ""}`;
            return `<button class="p-dot" data-w="${t.w}" data-saved="${S.list.has(p.id) ? 1 : 0}"
              data-jump="${esc(p.id)}" title="${esc(lab)}" aria-label="${esc(lab)}"><i></i></button>`;
          }).join("")
        : `<span class="p-empty">—</span>`) + `</div>`;
    }
  }

  const undated = rows.length - placed.length;
  return `<section class="plot-card">
    <div class="plot-head">
      <span class="plot-title">What kind of evidence answers this</span>
      <span class="plot-note">${placed.length} of ${rows.length} shown${undated ? ` · ${undated} undated` : ""}</span>
    </div>
    <div class="plot" style="--cols:${cols}" role="img" aria-label="Papers arranged by study design strength and publication era">${g}</div>
    <div class="plot-legend">
      <span class="lg" data-w="strong"><i></i>Strong design</span>
      <span class="lg" data-w="mid"><i></i>Observational</span>
      <span class="lg" data-w="weak"><i></i>Weak or indirect</span>
      <span class="lg" data-w="saved"><i></i>Saved</span>
      <span style="color:var(--faint)">Top rows carry most weight; right-hand column is most recent. Select a mark to jump to the paper.</span>
    </div>
  </section>`;
}

/* ══ Search view ═══════════════════════════════════════════ */

function renderSearch(){
  const hero = `<div>
    <div class="eyebrow">Search the medical literature</div>
    <h1 class="hero-h">Not just what the papers say — <em>what kind of papers they are.</em></h1>
    <p class="hero-sub">Every result is placed by study design and by how recent it is, so you can see at a glance whether a question is answered by current trials or by one old review. Literature from Europe PMC. No account, nothing stored anywhere but your own browser.</p>
  </div>

  <form id="search-form">
    <div class="bigfield">
      <label class="sr" for="q">Your search</label>
      <textarea id="q" rows="2" placeholder="SGLT2 inhibitors heart failure mortality" autocomplete="off" enterkeyhint="search">${esc(S.q)}</textarea>
      <button class="btn-go" type="submit" ${S.busy ? "disabled" : ""}>${S.busy ? "Searching" : "Search"}</button>
    </div>
    <div class="filters">
      <label class="sr" for="f-design">Study design</label>
      <select class="sel" id="f-design">
        ${DESIGN_FILTERS.map(d => `<option value="${d.k}"${S.design === d.k ? " selected" : ""}>${d.label}</option>`).join("")}
      </select>
      <label class="sr" for="f-sort">Sort by</label>
      <select class="sel" id="f-sort">
        ${SORTS.map(s => `<option value="${s.k}"${S.sort === s.k ? " selected" : ""}>${s.label}</option>`).join("")}
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
    const strong = S.results.filter(p => TIER[p.tier] && TIER[p.tier].w === "strong").length;
    results = `<div class="list-head">
        <span class="list-h">Results</span>
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

  $("view-search").innerHTML = hero + working + err + examples + results;
}

/* ══ Reading list view ═══════════════════════════════════════════ */

function listRows(){
  let rows = [...S.list.values()];
  if (S.filter) {
    const t = S.filter.toLowerCase();
    rows = rows.filter(p =>
      (p.title||"").toLowerCase().includes(t) ||
      (p.authors||"").toLowerCase().includes(t) ||
      (p.journal||"").toLowerCase().includes(t) ||
      (p.note||"").toLowerCase().includes(t));
  }
  const rank = Object.fromEntries(TIERS.map((t,i) => [t.k, i]));
  rows.sort((a,b) => (rank[a.tier] - rank[b.tier]) || ((b.year||0) - (a.year||0)));
  return rows;
}

function renderList(){
  const all = [...S.list.values()];
  if (!all.length) {
    $("view-list").innerHTML = `<div class="eyebrow">Reading list</div>
      <div class="empty">${svg("i-books")}<h3>Nothing saved yet</h3>
      <p>Save a paper from any search and it is kept in this browser, with its study design and your own note. Nothing is uploaded; clearing your browser data clears this.</p>
      <button class="btn btn-primary" data-go="search">${svg("i-search")}Search for something</button></div>`;
    return;
  }
  const rows = listRows();
  $("view-list").innerHTML = `<div class="eyebrow">Reading list</div>
    <h1 class="hero-h" style="font-size:clamp(24px,3.4vw,31px)">${all.length} paper${all.length === 1 ? "" : "s"} saved</h1>
    <p class="hero-sub" style="margin-top:8px">Kept in this browser only. Export them before you switch computer.</p>
    <div class="filters" style="padding-bottom:16px;border-bottom:1px solid var(--line-soft);margin-top:16px">
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
      ${TIERS.map(t => `<div class="ladder-row" data-w="${t.w}"><i></i><b>${t.label}</b><span>${t.note}</span></div>`).join("")}
    </div>
    <p>Rows near the top aggregate or control away more of the things that mislead — chance, confounding, selection. That ordering is a rule of thumb, not a law: a large well-run cohort can be worth more than a small poor trial, and for questions about rare harms or prognosis the observational rows are where the real evidence lives. A preclinical result is not weak science, it just does not answer a question about people.</p>

    <h2>The columns</h2>
    <p>Papers are grouped by publication era, oldest on the left. This answers a question clinicians ask constantly and search engines rarely show: <i>is the good evidence here still current?</i> A topic whose only synthesis sits in the left column, with all the trials on the right, is a topic where the summary has not caught up with the primary literature.</p>

    <h2>Where the classification comes from</h2>
    <p>Most records carry publication types assigned by indexers at the US National Library of Medicine — <code>Randomized Controlled Trial</code>, <code>Meta-Analysis</code>, <code>Practice Guideline</code> and so on. Those are used directly and are reliable.</p>
    <p>Records with no such tag — newer entries, preprints, some non-MEDLINE journals — are classified by reading the title and abstract for the usual signals. Those are marked <span class="chip" data-k="tier">Design <span class="chip-inf">inferred</span></span> on the card. Treat an inferred label as a hint and check the paper. This is also why a record can read <i>Design unclear</i>: it is more honest than a confident guess.</p>

    <h2>What it does not do</h2>
    <ul>
      <li>It does not read the papers or summarise their findings. No AI is involved anywhere in this site.</li>
      <li>It does not judge quality within a row — no risk-of-bias scoring, no journal ranking.</li>
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
  if (!S.open) { root.innerHTML = ""; return; }
  const saved = S.list.get(S.open.id);
  const p = saved || S.open;
  const paras = (p.abstract || "").split(/\n{2,}/).filter(Boolean);

  const kv = [];
  if (p.journal) kv.push(`<dt>Journal</dt><dd>${esc(p.journal)}${p.year ? `, <span class="num">${p.year}</span>` : ""}</dd>`);
  kv.push(`<dt>Design</dt><dd>${esc(p.design)} <span style="color:var(--faint);font-size:12px">(${p.designSrc === "metadata" ? "from the record's publication type" : "inferred from the abstract"})</span></dd>`);
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
      ${saved ? `
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

/* ══ Shell ═══════════════════════════════════════════ */

function render(){
  $("view-search").hidden = S.view !== "search";
  $("view-list").hidden   = S.view !== "list";
  $("view-about").hidden  = S.view !== "about";
  if (S.view === "search") renderSearch();
  if (S.view === "list")   renderList();
  if (S.view === "about")  renderAbout();

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
  S.view = "search";
  history.pushState({}, "", location.pathname);
  $("scroll").scrollTop = 0;
  render();
}

/* ══ Export ═══════════════════════════════════════════ */

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
  const t = ev.target.closest("[data-go],[data-ex],[data-open],[data-save],[data-jump],[data-redo],[data-export],#more,#save-all,#sheet-x,#bd,#sheet-save,#del-ask,#del-no,#del-yes,#note-save,#clear-ask,#clear-no,#clear-yes,#q-list-clear,#home-side,#home-top,#new-search,#clear-recent");
  if (!t) return;

  if (t.id === "home-side" || t.id === "home-top" || t.id === "new-search") { home(); return; }
  if (t.id === "clear-recent") { clearRecent(); return; }
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
      S.list.set(p.id, {...p, note:"", savedAt:new Date().toISOString(), fromQuery:S.lastQ});
      saveList(); render(); toast("Saved to reading list.");
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
      let n = 0;
      for (const p of S.results) if (!S.list.has(p.id)) {
        S.list.set(p.id, {...p, note:"", savedAt:new Date().toISOString(), fromQuery:S.lastQ}); n++;
      }
      if (n) { saveList(); render(); }
      toast(n ? `${n} paper${n === 1 ? "" : "s"} saved.` : "Those are all saved already.");
      break;
    }
    case "sheet-x": case "bd": S.open = null; S.confirmDel = false; renderSheet(); break;
    case "sheet-save": {
      const p = S.open;
      S.list.set(p.id, {...p, note:"", savedAt:new Date().toISOString(), fromQuery:S.lastQ});
      saveList(); render(); toast("Saved to reading list.");
      break;
    }
    case "del-ask": S.confirmDel = true; renderSheet(); break;
    case "del-no":  S.confirmDel = false; renderSheet(); break;
    case "del-yes": {
      S.list.delete(S.open.id); saveList();
      S.open = null; S.confirmDel = false; render(); toast("Removed.");
      break;
    }
    case "note-save": {
      const el = document.querySelector("#note");
      const cur = S.list.get(S.open.id);
      if (cur && el) {
        cur.note = el.value; saveList();
        const st = document.querySelector("#note-state");
        if (st) { st.textContent = "Note saved"; setTimeout(() => { if (st) st.textContent = ""; }, 2000); }
      }
      break;
    }
    case "clear-ask": S.confirmClear = true; render(); break;
    case "clear-no":  S.confirmClear = false; render(); break;
    case "clear-yes": {
      S.list.clear(); saveList(); S.confirmClear = false; render(); toast("Reading list cleared.");
      break;
    }
    case "q-list-clear": S.filter = ""; render(); $("q-list").focus(); break;
  }
});

document.addEventListener("submit", (ev) => {
  if (ev.target.id === "search-form") {
    ev.preventDefault();
    const el = $("q");
    runSearch(el ? el.value : S.q);
  }
});

document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.id === "q") S.q = el.value;
  if (el.id === "f-from") S.yearFrom = el.value.replace(/\D/g, "").slice(0, 4);
  if (el.id === "f-to")   S.yearTo   = el.value.replace(/\D/g, "").slice(0, 4);
  if (el.id === "q-list") {
    S.filter = el.value;
    if (S.view !== "list") go("list"); else render();
  }
});

document.addEventListener("change", (ev) => {
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

})();
