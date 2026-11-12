/* Builds the offline validation set the classifier tests run against.
 *
 *   node tools/build-fixture.mjs
 *
 * It lives in tools/ rather than test/, which is where the review asked for it, because
 * `node --test` treats every file under test/ as a test file and would run this one on
 * every push, hitting Europe PMC from CI.
 *
 * Needs network. It is run by hand when the fixture should be refreshed, never by CI:
 * CI runs the tests against the committed test/fixtures/medline-sample.json so the suite
 * does not depend on Europe PMC being up, or on its index shifting under us.
 *
 * What it collects: MEDLINE records that carry an indexed publication type, which is the
 * only thing that can serve as truth here. The types are assigned by human indexers at the
 * NLM, so "does the text-only guess agree with them" is a question with a real answer.
 *
 * Three deliberate choices, because each one limits what the measured figure means:
 *
 *  1. Year bands are closed and in the past (nothing from 2024 on). That makes the fixture
 *     reproducible, but it also means the sample cannot show the problem that recent
 *     records often have no indexed type at all. The figure measures agreement with the
 *     indexers, not coverage of the literature.
 *  2. Records are taken by a fixed stride through a date-sorted page rather than off the
 *     top, so one busy month or one journal cannot dominate a bucket.
 *  3. Animal studies have no indexed design type to be right or wrong about, so they are
 *     collected by MeSH instead and used only as negative controls: the classifier must
 *     not call them trials or syntheses.
 */

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const BANDS = [[2004, 2010], [2011, 2017], [2018, 2023]];
const PER_BAND = 13;          /* 13 x 3 bands x 8 buckets = 312 records */
const POOL = 100;             /* read this many, then stride through them */

/* bucket -> the Europe PMC query that defines it. `truth` is the tier the indexed type
   means, which is what the guess is compared against. Animals have no truth. */
const BUCKETS = [
  {k:"meta",      truth:"synthesis", q:'PUB_TYPE:"Meta-Analysis"'},
  {k:"sysrev",    truth:"synthesis", q:'PUB_TYPE:"Systematic Review"'},
  {k:"guideline", truth:"guideline", q:'PUB_TYPE:"Practice Guideline"'},
  {k:"rct",       truth:"trial",     q:'PUB_TYPE:"Randomized Controlled Trial"'},
  {k:"obs",       truth:"cohort",    q:'PUB_TYPE:"Observational Study"'},
  {k:"case",      truth:"case",      q:'PUB_TYPE:"Case Reports"'},
  {k:"review",    truth:"narrative", q:'PUB_TYPE:"Review"'},
  {k:"animal",    truth:null,        q:'MESH:"Mice"'}
];

const get = async url => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, {headers:{Accept:"application/json"}});
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} on ${url}`);
    await new Promise(s => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error("gave up after 4 attempts: " + url);
};

/* Only the fields the classifier reads, plus enough to identify a record by hand. Keeping
   the whole core record would make the fixture several megabytes of data no test touches. */
const keep = (r, bucket, truth) => ({
  pmid: r.pmid || r.id,
  bucket, truth,
  title: r.title || "",
  pubYear: r.pubYear ? Number(r.pubYear) : null,
  journal: ((r.journalInfo || {}).journal || {}).title || "",
  pubTypeList: {pubType: ((r.pubTypeList || {}).pubType || [])},
  abstractText: r.abstractText || ""
});

const out = [];
for (const b of BUCKETS) {
  for (const [from, to] of BANDS) {
    const p = new URLSearchParams({
      query: `${b.q} AND HAS_ABSTRACT:Y AND SRC:MED AND PUB_YEAR:[${from} TO ${to}]`,
      format: "json", resultType: "core", pageSize: String(POOL), sort: "P_PDATE_D desc"
    });
    const d = await get(API + "?" + p);
    const rows = (d.resultList && d.resultList.result) || [];
    const stride = Math.max(1, Math.floor(rows.length / PER_BAND));
    let taken = 0;
    for (let i = 0; i < rows.length && taken < PER_BAND; i += stride) {
      const r = rows[i];
      /* An abstract under 200 characters is usually a stub, and gives the text arm nothing
         to read, which would measure the fixture rather than the classifier. */
      if ((r.abstractText || "").length < 200) continue;
      out.push(keep(r, b.k, b.truth));
      taken++;
    }
    console.error(`  ${b.k.padEnd(10)} ${from}-${to}  ${String(rows.length).padStart(3)} read, ${taken} kept  (of ${d.hitCount})`);
    await new Promise(s => setTimeout(s, 200));   /* Europe PMC asks for a gentle rate */
  }
}

const path = new URL("../test/fixtures/medline-sample.json", import.meta.url);
const { writeFileSync } = await import("node:fs");
writeFileSync(path, JSON.stringify({
  note: "Built by test/build-fixture.mjs. Indexed MEDLINE publication types are the truth; " +
        "the tests strip pubTypeList to measure what the text alone would have said.",
  built: new Date().toISOString().slice(0, 10),
  bands: BANDS, count: out.length, records: out
}, null, 1) + "\n");
console.error(`\n${out.length} records -> ${path.pathname}`);
