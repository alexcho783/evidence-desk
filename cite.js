/* Evidence Desk — reference formatting and .docx export.
 *
 * Self-contained: takes saved records and produces formatted references in a chosen style,
 * either as text or as a Word document. The docx library is ~1.3 MB, so it is fetched only
 * when someone actually exports, never on page load.
 *
 * A reference is built as a list of runs — {t: text, i: italic} — rather than a string,
 * because every style italicises something (the journal, the volume) and a plain string
 * would lose that on the way into Word.
 */
(() => {
"use strict";

/* The bundle's extension is .cjs, which jsDelivr serves as application/node with nosniff —
   a script tag refuses to execute that. unpkg serves the same bytes as text/javascript, so
   it goes first; if it is unreachable, the jsDelivr copy is fetched and re-injected through
   a blob URL, where we choose the type ourselves. */
const DOCX_SRC = "https://unpkg.com/docx@9.13.0/dist/index.umd.cjs";
const DOCX_FALLBACK = "https://cdn.jsdelivr.net/npm/docx@9.13.0/dist/index.umd.cjs";

const STYLES = [
  {k:"vancouver", label:"Vancouver", numbered:true,  note:"Numbered in the order you saved them. Used by most medical journals and UK medical schools."},
  {k:"apa7",      label:"APA 7th",   numbered:false, note:"Alphabetical by first author. Standard in psychology."},
  {k:"harvard",   label:"Harvard",   numbered:false, note:"Alphabetical by first author. Common for UK coursework and EPQs."}
];

/* ── helpers ─────────────────────────────────────────── */

const clean = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
const stripDot = s => clean(s).replace(/\.$/, "");

/* Saved records hold a structured author list where the source gave one. Older records,
   and trials, only have the display string, so fall back to that rather than drop names. */
function authors(p){
  const list = Array.isArray(p.authorList) ? p.authorList.filter(a => a && a.last) : [];
  if (list.length) return list;
  const s = clean(p.authors);
  if (!s) return [];
  return s.split(/,\s*|\sand\s|&/).map(x => clean(x)).filter(Boolean)
    .filter(x => !/^et al\.?$/i.test(x))
    .map(x => {
      const parts = x.split(/\s+/);
      if (parts.length === 1) return {last: parts[0], first: "", initials: ""};
      /* "Packer M" — a trailing initial block means surname first. */
      if (/^[A-Z]{1,3}$/.test(parts[parts.length - 1]))
        return {last: parts.slice(0, -1).join(" "), first: "", initials: parts[parts.length - 1]};
      const last = parts.pop();
      return {last, first: parts.join(" "), initials: parts.map(w => w[0]).join("")};
    });
}

const initialsOf = a => clean(a.initials || (a.first ? a.first.split(/\s+/).map(w => w[0]).join("") : ""));

/* Vancouver: "Packer M, Anker SD, Butler J, et al." — six, then et al. */
function vancouverAuthors(list){
  if (!list.length) return "";
  const names = list.slice(0, 6).map(a => `${a.last}${initialsOf(a) ? " " + initialsOf(a) : ""}`);
  return names.join(", ") + (list.length > 6 ? ", et al." : "");
}

/* APA: "Packer, M., Anker, S. D., & Butler, J." — periods and spaces between initials. */
function apaAuthors(list){
  if (!list.length) return "";
  const fmt = a => {
    const ini = initialsOf(a).split("").map(c => c + ".").join(" ");
    return `${a.last}${ini ? ", " + ini : ""}`;
  };
  const shown = list.slice(0, 20).map(fmt);
  if (list.length === 1) return shown[0];
  if (list.length > 20) return shown.slice(0, 19).join(", ") + ", ... " + fmt(list[list.length - 1]);
  return shown.slice(0, -1).join(", ") + ", & " + shown[shown.length - 1];
}

/* Harvard: like APA but "and" before the last name and no comma before it. */
function harvardAuthors(list){
  if (!list.length) return "";
  const fmt = a => {
    const ini = initialsOf(a).split("").map(c => c + ".").join("");
    return `${a.last}${ini ? ", " + ini : ""}`;
  };
  const shown = list.map(fmt);
  if (shown.length === 1) return shown[0];
  if (shown.length > 3) return shown[0] + " et al.";
  return shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1];
}

/* Europe PMC stores journal names in sentence case ("The New England journal of medicine").
   APA and Harvard both want title case, so the major words are raised. Vancouver uses the
   ISO abbreviation instead and is left alone. */
const SMALL = new Set(["a","an","and","as","at","but","by","for","in","nor","of","on","or",
                       "the","to","up","via","with","from"]);
function titleCaseJournal(s){
  const t = clean(s);
  if (!t || t === t.toUpperCase()) return t;       /* leave acronyms alone */
  return t.split(" ").map((w, i) => {
    const bare = w.toLowerCase();
    if (i > 0 && SMALL.has(bare)) return bare;
    if (/[A-Z]/.test(w.slice(1))) return w;        /* already mixed, e.g. BMJ, PLoS */
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

const volIssue = p => clean(p.volume) + (clean(p.issue) ? `(${clean(p.issue)})` : "");
const pagesOf = p => clean(p.pages).replace(/-/g, "–");

/* ── the styles ─────────────────────────────────────────── */

function trialRef(p, style){
  /* A registration is not a journal article; every style treats it as a database record. */
  const sponsor = clean(p.authors) || "Study sponsor";
  const runs = [{t: `${sponsor}. ${stripDot(p.title)}. `}];
  runs.push({t: "ClinicalTrials.gov", i: true});
  runs.push({t: ` identifier: ${p.nct || "n/a"}.${p.year ? " " + p.year + "." : ""} ${p.url || ""}`});
  return runs;
}

/* Wraps the style formatters so an integrity marker rides along into the document.
   A retracted paper that exports looking like any other reference is the exact failure
   this flag exists to prevent, so the marker is loud and leads the entry. */
function format(p, style){
  const runs = formatBase(p, style);
  if (p.retracted) return [{t:"[RETRACTED] ", warn:true}, ...runs];
  if (p.concern)   return [{t:"[EXPRESSION OF CONCERN] ", warn:true}, ...runs];
  if (p.preprint)  return [...runs, {t:" Preprint, not peer reviewed."}];
  return runs;
}

function formatBase(p, style){
  if (p.source === "trials") return trialRef(p, style);

  const list = authors(p);
  const yr = p.year || "n.d.";
  const title = stripDot(p.title);
  const jrnl = clean(p.journalAbbrev) || clean(p.journal);
  const jrnlFull = titleCaseJournal(clean(p.journal) || clean(p.journalAbbrev));
  const vi = volIssue(p);
  const pg = pagesOf(p);
  const doi = clean(p.doi);

  if (style === "apa7") {
    const runs = [{t: `${apaAuthors(list)}${apaAuthors(list) ? " " : ""}(${yr}). ${title}. `}];
    if (jrnlFull) runs.push({t: jrnlFull, i: true});
    if (clean(p.volume)) { runs.push({t: ", "}); runs.push({t: clean(p.volume), i: true});
      if (clean(p.issue)) runs.push({t: `(${clean(p.issue)})`}); }
    if (pg) runs.push({t: `, ${pg}`});
    runs.push({t: "."});
    if (doi) runs.push({t: ` https://doi.org/${doi}`});
    return runs;
  }

  if (style === "harvard") {
    const runs = [{t: `${harvardAuthors(list)}${harvardAuthors(list) ? " " : ""}(${yr}) '${title}', `}];
    if (jrnlFull) runs.push({t: jrnlFull, i: true});
    if (vi) runs.push({t: `, ${vi}`});
    if (pg) runs.push({t: `, pp. ${pg}`});
    runs.push({t: "."});
    if (doi) runs.push({t: ` doi: ${doi}.`});
    return runs;
  }

  /* Vancouver */
  const a = vancouverAuthors(list);
  /* "et al." already carries its own full stop; a second one is a visible error. */
  const aSep = a ? (a.endsWith(".") ? " " : ". ") : "";
  const runs = [{t: `${a}${aSep}${title}. `}];
  if (jrnl) runs.push({t: `${jrnl}. `});
  runs.push({t: `${yr}` + (vi ? `;${vi}` : "") + (pg ? `:${pg}` : "") + "."});
  if (doi) runs.push({t: ` doi:${doi}`});
  return runs;
}

const plain = runs => runs.map(r => r.t).join("");

/* Vancouver keeps the order you saved them; the author–date styles are alphabetical. */
function order(rows, style){
  const copy = rows.slice();
  if (style === "vancouver") {
    copy.sort((x, y) => String(x.savedAt || "").localeCompare(String(y.savedAt || "")));
    return copy;
  }
  const key = p => {
    const l = authors(p);
    return ((l[0] && l[0].last) || clean(p.authors) || clean(p.title)).toLowerCase();
  };
  copy.sort((x, y) => key(x).localeCompare(key(y)) || (x.year || 0) - (y.year || 0));
  return copy;
}

/* ── Word export ─────────────────────────────────────────── */

let docxLoading = null;
function loadDocx(){
  if (window.docx) return Promise.resolve(window.docx);
  if (docxLoading) return docxLoading;
  const inject = src => new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => window.docx ? res(window.docx) : rej(new Error("loaded but empty"));
    el.onerror = () => rej(new Error("blocked"));
    document.head.appendChild(el);
  });

  docxLoading = inject(DOCX_SRC).catch(async () => {
    const text = await fetch(DOCX_FALLBACK).then(r => {
      if (!r.ok) throw new Error("fallback " + r.status);
      return r.text();
    });
    const url = URL.createObjectURL(new Blob([text], {type:"text/javascript"}));
    try { return await inject(url); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
  });
  return docxLoading;
}

async function toDocxBlob(name, rows, styleKey){
  const d = await loadDocx();
  const style = STYLES.find(s => s.k === styleKey) || STYLES[0];
  const sorted = order(rows, style.k);

  const children = [
    new d.Paragraph({
      children: [new d.TextRun({text: name || "References", bold: true, size: 28})],
      spacing: {after: 240}
    })
  ];

  sorted.forEach((p, i) => {
    const runs = format(p, style.k);
    const bits = [];
    if (style.numbered) bits.push(new d.TextRun({text: `${i + 1}. `}));
    for (const r of runs) bits.push(new d.TextRun({
      text: r.t, italics: !!r.i,
      ...(r.warn ? {bold: true, color: "B3261E"} : {})
    }));
    children.push(new d.Paragraph({
      children: bits,
      spacing: {after: 160, line: 360},
      /* Author–date styles want a hanging indent; a numbered list does not. */
      indent: style.numbered ? undefined : {left: 720, hanging: 720}
    }));
  });

  const flagged = sorted.filter(p => p.retracted || p.concern).length;
  if (flagged) {
    children.push(new d.Paragraph({
      children: [new d.TextRun({
        text: `Warning: ${flagged} of these ${flagged === 1 ? "references has" : "references have"} been retracted or had an expression of concern raised. Remove ${flagged === 1 ? "it" : "them"} before submitting.`,
        bold: true, color: "B3261E", size: 20
      })],
      spacing: {before: 300}
    }));
  }
  children.push(new d.Paragraph({
    children: [new d.TextRun({
      text: `${sorted.length} reference${sorted.length === 1 ? "" : "s"} · ${style.label} · exported from Evidence Desk. Check every reference before submitting.`,
      size: 16, color: "888888"
    })],
    spacing: {before: 400}
  }));

  return d.Packer.toBlob(new d.Document({sections: [{children}]}));
}

/* An evidence table is the skeleton of a literature review: one row per study, with the
   things you have to compare it on. Landscape, because four columns of prose is not a
   portrait shape. */
async function toTableDocxBlob(name, rows){
  const d = await loadDocx();
  const sorted = order(rows, "vancouver");

  const cell = (text, opts) => new d.TableCell({
    children: [new d.Paragraph({
      children: [new d.TextRun({text: String(text == null ? "" : text), ...(opts || {})})],
      spacing: {before: 60, after: 60}
    })],
    margins: {top: 60, bottom: 60, left: 100, right: 100}
  });

  const header = new d.TableRow({
    tableHeader: true,
    children: ["Study", "Design", "Sample", "Your note"].map(h => cell(h, {bold: true}))
  });

  const body = sorted.map(p => {
    const who = authors(p)[0];
    const study = `${who ? who.last : clean(p.authors) || "Unknown"}${p.year ? ` (${p.year})` : ""}`;
    const flag = p.retracted ? "RETRACTED — " : p.preprint ? "Preprint — " : "";
    return new d.TableRow({children: [
      new d.TableCell({
        children: [
          new d.Paragraph({children: [new d.TextRun({text: flag + study, bold: true,
            ...(p.retracted ? {color: "B3261E"} : {})})]}),
          new d.Paragraph({children: [new d.TextRun({text: stripDot(p.title), size: 18})], spacing: {after: 60}})
        ],
        margins: {top: 60, bottom: 60, left: 100, right: 100}
      }),
      cell(p.design || ""),
      cell(p.n ? String(p.n) : "not stated"),
      cell(p.note || "")
    ]});
  });

  const doc = new d.Document({sections: [{
    properties: {page: {size: {orientation: d.PageOrientation.LANDSCAPE}}},
    children: [
      new d.Paragraph({children: [new d.TextRun({text: name || "Evidence table", bold: true, size: 28})],
        spacing: {after: 200}}),
      new d.Table({width: {size: 100, type: d.WidthType.PERCENTAGE}, rows: [header, ...body]}),
      new d.Paragraph({children: [new d.TextRun({
        text: `${sorted.length} stud${sorted.length === 1 ? "y" : "ies"} · exported from Evidence Desk. Designs are as indexed, not as judged; check each one.`,
        size: 16, color: "888888"})], spacing: {before: 300}})
    ]
  }]});
  return d.Packer.toBlob(doc);
}

window.EDCite = { STYLES, format, plain, order, toDocxBlob, toTableDocxBlob, authors };

})();
