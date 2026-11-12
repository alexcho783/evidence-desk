/* Tests for the classifier. Run with:  node --test
 *
 * Two kinds of check:
 *
 *  1. Agreement against human indexing. Every record in the fixture carries publication
 *     types assigned by indexers at the NLM. classify() is run twice on each one: with the
 *     types, which is the truth, and with pubTypeList removed, which is what the site
 *     actually does for a record MEDLINE has not indexed yet. The gap between the two is
 *     the honest measure of how much the inferred labels can be trusted, and it is printed
 *     as a confusion table so the failure modes are visible rather than averaged away.
 *
 *  2. Hand-written edge cases, which is where the regressions actually show up. The
 *     fixture is 300 ordinary papers; these are the twenty awkward ones.
 *
 * The agreement floor is deliberately a little below the measured figure. It is there to
 * catch a change that breaks the classifier, not to be adjusted upwards after every
 * improvement. Raise it only when the gain is real and you have rerun the fixture.
 */

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classify, classifyPsy, findN} from "../classify.js";

const FLOOR = 48;            /* per cent; measured 51.1 at the time of writing */

const fixture = JSON.parse(readFileSync(new URL("./fixtures/medline-sample.json", import.meta.url), "utf8"));

/* app.js strips inline markup in normalise() before classify() ever sees a record, using
   DOMParser. There is no DOM here, so this mirrors plain()'s own regex fallback. */
const plain = s => String(s == null ? "" : s).replace(/<[^>]+>/g, " ");
const clean = r => ({...r, title: plain(r.title), abstractText: plain(r.abstractText)});

/* "Design unclear" is reported at narrative level, which would otherwise hide inside the
   narrative column and make not knowing look like a judgement. */
const klass = c => c.design === "Design unclear" ? "unclear" : c.tier;

test("fixture is the shape the tests assume", () => {
  assert.ok(fixture.records.length >= 250, `only ${fixture.records.length} records`);
  const buckets = new Set(fixture.records.map(r => r.bucket));
  for (const k of ["meta", "sysrev", "guideline", "rct", "obs", "case", "review", "animal"])
    assert.ok(buckets.has(k), `no ${k} records`);
  for (const r of fixture.records) assert.ok(Array.isArray(r.pubTypeList.pubType));
});

test("inferred designs agree with MEDLINE indexing", () => {
  const scored = fixture.records.map(clean).filter(r => classify(r).src === "metadata");
  const conf = {}, perBucket = {};
  let agree = 0;
  for (const r of scored) {
    const truth = klass(classify(r));
    const guess = klass(classify({...r, pubTypeList: null}));
    if (truth === guess) agree++;
    (conf[truth] ||= {})[guess] = ((conf[truth] || {})[guess] || 0) + 1;
    const b = (perBucket[r.bucket] ||= {ok: 0, n: 0});
    b.n++; if (truth === guess) b.ok++;
  }
  const pc = 100 * agree / scored.length;
  /* The looser figure, which credits a record the text could not read at all as agreeing
     with an indexed narrative review, because "Design unclear" is reported at narrative
     level. It is printed only so the stricter number above it cannot be mistaken for it. */
  let loose = 0;
  for (const r of scored)
    if (classify(r).tier === classify({...r, pubTypeList: null}).tier) loose++;

  const cls = [...new Set(Object.keys(conf).concat(...Object.values(conf).map(Object.keys)))].sort();
  const pad = s => String(s).padStart(10);
  console.log(`\n  Agreement with MEDLINE indexing: ${agree}/${scored.length} = ${pc.toFixed(1)}%`);
  console.log(`  (${(100 * loose / scored.length).toFixed(1)}% if "Design unclear" is allowed to count as a narrative match)`);
  console.log(`  (of ${fixture.records.length} records; the rest carry no indexed design type to compare against)\n`);
  console.log("  rows = what the indexers said, columns = what the text alone said");
  console.log("  " + "".padEnd(13) + cls.map(pad).join(""));
  for (const t of cls.filter(t => conf[t]))
    console.log("  " + t.padEnd(13) + cls.map(g => pad(conf[t][g] || "·")).join(""));
  console.log("\n  by bucket: " + Object.entries(perBucket)
    .map(([k, v]) => `${k} ${v.ok}/${v.n}`).join("   ") + "\n");

  assert.ok(pc >= FLOOR, `agreement fell to ${pc.toFixed(1)}%, below the ${FLOOR}% floor`);
});

test("animal studies are never promoted to human evidence", () => {
  /* There is no indexed design type for an animal study, so these cannot be scored for
     agreement. They are here as negative controls: whatever the classifier decides, it
     must not place a mouse experiment on a row that means evidence about people. */
  const wrong = fixture.records.filter(r => r.bucket === "animal")
    .map(r => ({r, c: classify({...clean(r), pubTypeList: null})}))
    .filter(x => ["trial", "synthesis", "guideline"].includes(x.c.tier));
  const note = wrong.map(x => `${x.c.design} ("${x.c.because}") <- ${x.r.title.slice(0, 70)}`).join("\n    ");
  /* One record in the set is a genuine meta-analysis of animal studies, which is a
     synthesis and correctly labelled, so this is not asserted at zero. */
  assert.ok(wrong.length <= 2, `${wrong.length} animal records promoted:\n    ${note}`);
});

/* ── The awkward twenty ──────────────────────────────────────────────── */

const CASES = [
  ["a systematic review of RCTs",
   "Beta-blockers after myocardial infarction: a systematic review and meta-analysis of randomised controlled trials",
   "We systematically searched MEDLINE and Embase for randomised controlled trials. Thirty-one trials with 24,974 patients were pooled using a random-effects model.",
   {tier: "synthesis", design: "Meta-analysis"}],

  ["a systematic review with no meta-analysis",
   "Interventions for preventing falls in care homes: a systematic review",
   "We searched six databases. Heterogeneity precluded pooling, so results are reported narratively.",
   {tier: "synthesis", design: "Systematic review"}],

  ["a network meta-analysis says so in its reason",
   "Comparative efficacy of SGLT2 inhibitors: a systematic review and network meta-analysis",
   "Thirty-four trials were compared in a random-effects network meta-analysis.",
   {tier: "synthesis", design: "Meta-analysis", because: /network meta/}],

  ["an umbrella review",
   "Umbrella review of vitamin D supplementation and mortality",
   "We reviewed 14 published systematic reviews and meta-analyses of vitamin D supplementation.",
   {tier: "synthesis"}],

  ["a scoping review is not a synthesis",
   "Digital mental health interventions for adolescents: a scoping review",
   "We mapped the literature across five databases and charted the available evidence.",
   {tier: "narrative", design: "Review"}],

  ["a target trial emulation is not a trial",
   "Comparative effectiveness of SGLT2 inhibitors versus DPP-4 inhibitors: a target trial emulation",
   "Using a target trial emulation framework with propensity-score matching in a retrospective cohort of 48,000 adults with type 2 diabetes, we estimated the hazard of hospitalisation.",
   {notTier: "trial"}],

  ["a large RCT",
   "Dexamethasone in hospitalised patients with Covid-19",
   "In this controlled, open-label trial, 6425 patients were randomly assigned to receive dexamethasone or usual care. Mortality at 28 days was lower in the dexamethasone group.",
   {tier: "trial"}],

  ["a trial protocol is a plan, not a result",
   "Effect of early mobilisation after stroke: study protocol for a randomised controlled trial",
   "This is the protocol for a multicentre, open-label randomised controlled trial. Participants will be randomly assigned to early mobilisation or usual care. Recruitment begins in March.",
   {design: "Trial protocol", notTier: "trial"}],

  ["a mouse study that randomised its mice",
   "Fluoxetine reduces infarct volume in a mouse model of stroke",
   "Mice were randomised to fluoxetine or vehicle after middle cerebral artery occlusion. Infarct volume was measured at 24 hours in 40 animals.",
   {tier: "preclinical", design: "Animal study"}],

  ["an in vitro study",
   "PMP22 overexpression impairs Schwann cell myelination in vitro",
   "Using rat Schwann cell lines and dorsal root ganglion co-cultures, we show that PMP22 overexpression reduces myelin formation.",
   {tier: "preclinical", design: "In vitro"}],

  ["a modelling study",
   "Projected impact of vaccination on measles transmission",
   "We built a deterministic compartmental mathematical model to simulate measles transmission under four vaccination scenarios.",
   {tier: "preclinical", design: "Modelling"}],

  ["a commentary on a trial",
   "Dapagliflozin in heart failure: a new era?",
   "In a recent issue of this journal, the DAPA-HF investigators reported a striking reduction in cardiovascular death. This commentary considers what the result means for practice.",
   {tier: "narrative", design: "Commentary"}],

  ["Wakefield 1998",
   "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
   "Twelve children were referred to a paediatric gastroenterology unit. We describe a consecutive series of children with a history of normal development followed by loss of acquired skills.",
   {tier: "case", design: "Case series"}],

  ["a single case report",
   "Acute hepatitis after curcumin supplementation",
   "We report a case of a 54-year-old woman who presented with jaundice two weeks after starting a high-dose curcumin supplement. The index patient had no other exposures.",
   {tier: "case", design: "Case report"}],

  ["a practice guideline",
   "Management of type 2 diabetes in adults: a clinical practice guideline",
   "This guideline provides evidence-based recommendations for adults with type 2 diabetes. The guideline development group graded the strength of each recommendation using GRADE.",
   {tier: "guideline"}],

  ["a consensus statement is told apart from a guideline",
   "European consensus statement on the diagnosis of inherited neuropathies",
   "A panel of 24 experts used a modified Delphi process. Agreement above 80 per cent was required for each statement.",
   {tier: "guideline", design: "Consensus statement"}],

  ["a cohort study",
   "Long-term risk of dementia after traumatic brain injury: a nationwide cohort study",
   "We followed 2.8 million adults for a median of 9.4 years of follow-up using national registers.",
   {tier: "cohort", design: "Cohort study"}],

  ["a case-control study",
   "Early-life antibiotic exposure and childhood asthma",
   "In this case-control study we matched 1,200 children with asthma to 4,800 controls by age and sex.",
   {tier: "cohort", design: "Case–control"}],

  ["a cross-sectional survey",
   "Prevalence of burnout among junior doctors: a cross-sectional survey",
   "A questionnaire survey was distributed to 1,200 junior doctors across 14 hospitals.",
   {tier: "cohort", design: "Cross-sectional"}],

  ["an abstract with no design signal at all",
   "Reflections on forty years in general practice",
   "The author looks back on changes in primary care since 1984 and what they have meant for the doctor-patient relationship.",
   {design: "Design unclear"}],

  ["indexed metadata always beats the text",
   "Randomised trial of aspirin: a systematic review of our own data",
   "Patients were randomly assigned to aspirin or placebo in this double-blind trial.",
   {tier: "trial", src: "metadata", types: ["Randomized Controlled Trial"]}]
];

for (const [name, title, abstractText, want] of CASES) {
  test(name, () => {
    const r = {title, abstractText};
    if (want.types) r.pubTypeList = {pubType: want.types};
    const c = classify(r);
    const got = `${c.design} / ${c.tier} / ${c.src} / "${c.because}"`;
    if (want.tier)    assert.equal(c.tier, want.tier, got);
    if (want.notTier) assert.notEqual(c.tier, want.notTier, got);
    if (want.design)  assert.equal(c.design, want.design, got);
    if (want.src)     assert.equal(c.src, want.src, got);
    if (want.because) assert.match(c.because, want.because, got);
    /* Whatever the label, the reason has to be a phrase that is really in the record, or
       the card is telling the reader something untrue. */
    if (c.src === "inferred" && c.because)
      assert.ok(`${title} ${abstractText}`.toLowerCase().includes(c.because.toLowerCase()),
        `reason "${c.because}" is not in the text`);
  });
}

/* ── Psychology, which has no metadata arm at all ────────────────────── */

test("classifyPsy reads the designs psychology actually uses", () => {
  const cases = [
    ["Semi-structured interviews with 18 carers were analysed using thematic analysis.", "qualitative"],
    ["Participants were randomly assigned to one of three conditions. Reaction times were recorded.", "trial"],
    ["In two experiments, stimuli were counterbalanced across within-subjects conditions.", "experiment"],
    ["A cross-sectional questionnaire was completed by an online panel of 900 adults.", "survey"],
    ["Children were followed across four waves of longitudinal assessment.", "cohort"],
    ["We meta-analytically pooled 44 studies of working memory training.", "synthesis"]
  ];
  for (const [abstract, tier] of cases)
    assert.equal(classifyPsy("", abstract, null).tier, tier, abstract.slice(0, 50));
});

test("classifyPsy says which phrase produced the label", () => {
  /* OpenAlex carries no publication types, so every psychology label is inferred. The
     phrase is the only thing a reader can check the label against, which makes it matter
     more here than on the medicine side. */
  const cases = [
    ["", "Semi-structured interviews with 18 carers were analysed using thematic analysis."],
    ["", "In two experiments, stimuli were counterbalanced across conditions."],
    ["A meta-analysis of working memory training", "We pooled 44 studies."],
    ["", "Children were followed across four waves of assessment."]
  ];
  for (const [title, abstract] of cases) {
    const c = classifyPsy(title, abstract, null);
    assert.notEqual(c.design, "Design unclear", abstract.slice(0, 40));
    assert.ok(c.because, `no reason given for: ${abstract.slice(0, 40)}`);
    assert.ok(`${title} ${abstract}`.toLowerCase().includes(c.because.toLowerCase()),
      `reason "${c.because}" is not in the text`);
  }
  /* Nothing recognised must say nothing, not guess a phrase. */
  const none = classifyPsy("", "The author reflects on forty years of practice.", null);
  assert.equal(none.design, "Design unclear");
  assert.equal(none.because, "");
  /* OpenAlex's own record type is not a phrase from the text, so it is not quoted as one. */
  const byType = classifyPsy("", "Nothing recognisable here at all.", "review");
  assert.equal(byType.design, "Review");
  assert.equal(byType.because, "");
  assert.equal(byType.fromType, true);
});

test("findN pulls a sample size out, or nothing", () => {
  const n = t => findN({abstractText: t}).n;
  assert.equal(n("A total of 6425 patients were enrolled."), 6425);
  assert.equal(n("We randomised participants (n = 1,200) to two arms."), 1200);
  assert.equal(n("No numbers here at all."), null);
  assert.equal(n("In 1 patient the drug failed."), null, "1 is not a sample");
  assert.equal(findN({}).n, null);
});

test("findN says when the number is only a guess", () => {
  /* A bare "n = " is very often a subgroup, and the marker that depends on this must not
     draw a 1,407-person study as a small one because it found a 494-person phenotype. */
  const sub = findN({abstractText:
    "Among 1,407 young women with heart failure, four phenotypes were identified: " +
    "hypertensive pregnancy (n=494), cardiorenal (n=276)."});
  assert.equal(sub.n, 1407, "the total, not the first subgroup");
  assert.equal(sub.sure, true);

  for (const [t, nn] of [
    ["In this open-label trial, 6425 patients were randomly assigned to dexamethasone.", 6425],
    ["We enrolled 38 adults with CMT1A.", 38],
    ["The sample of 212 students completed the task.", 212],
    ["Of 2,500 older adults screened, 1,200 entered the study.", 2500]
  ]) {
    const r = findN({abstractText: t});
    assert.equal(r.n, nn, t.slice(0, 44));
    assert.equal(r.sure, true, `should be confident: ${t.slice(0, 44)}`);
  }

  /* Wakefield 1998, which is what the small-study marker is tested against. The number is
     separated from its verb by a parenthetical, and the children were referred rather than
     enrolled, both of which an earlier version of this missed. */
  const wake = findN({abstractText:
    "12 children (mean age 6 years [range 3-10], 11 boys) were referred to a " +
    "paediatric gastroenterology unit with a history of normal development."});
  assert.equal(wake.n, 12);
  assert.equal(wake.sure, true);

  /* No announcement of a total means no confidence, whatever number turns up. */
  const guess = findN({abstractText: "Responses in the placebo arm (n = 31) were lower."});
  assert.equal(guess.n, 31);
  assert.equal(guess.sure, false);

  /* Abstracts spell small counts out as often as they write digits. */
  for (const [t, nn] of [
    ["Twenty-five participants were randomly assigned to each arm.", 25],
    ["One hundred and twenty patients were enrolled across six centres.", 120],
    ["Two hundred patients were recruited.", 200]
  ]) {
    const r = findN({abstractText: t});
    assert.equal(r.n, nn, t.slice(0, 44));
    assert.equal(r.sure, true, t.slice(0, 44));
  }

  /* Two groups in one sentence is a total nobody stated, and adding them up is a
     judgement this should not make. "Forty-seven CMT1A and 18 HNPP patients" is 65
     people; reporting the 47 would be the subgroup mistake in a new costume. */
  const twoGroups = findN({abstractText: "Forty-seven CMT1A and 18 HNPP patients were included."});
  assert.equal(twoGroups.sure, false, "a two-group count must never be reported as certain");

  /* "forty years" is not forty people. */
  assert.equal(findN({abstractText: "The author reflects on forty years in practice."}).n, null);

  /* Nothing found must never read as a small study. */
  const none = findN({abstractText: "The author reflects on forty years of practice."});
  assert.equal(none.n, null);
  assert.equal(none.sure, false);
});
