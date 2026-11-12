/* Evidence Desk — the classifier, on its own and with no DOM
 *
 * Kept apart from app.js so it can be run under `node --test` against a fixture of real
 * MEDLINE records. Nothing here touches the document, fetches anything or reads state:
 * every function is a pure function of the record passed in. If that stops being true the
 * tests stop being able to run, so keep it that way.
 *
 * Callers are expected to have stripped inline markup from the title and abstract first
 * (app.js does this in normalise() via plain()); the patterns here assume plain text.
 */

/* ══ Classification ═══════════════════════════════════════════
 * Study design comes from the publication types Europe PMC carries over from MEDLINE.
 * Where a record has none, we fall back to reading the abstract, and say so on the card. */

export function classify(r){
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
    /* The title decides when it says anything; only a body-triggered match falls back
       to the body, or a plain systematic review is called a meta-analysis. */
    const isMeta = /meta-analys|meta analys|network meta/.test(ttl)
      || (!synthTitle && re(/\bmeta-analys/));
    /* The phrase quoted on the card has to be the one that produced the label. Most of
       these titles say "A Systematic Review and Meta-Analysis", and taking the first
       match would quote the weaker half against the stronger label. */
    if (synthTitle) {
      const pick = isMeta ? /network meta-?analys\w*|meta-?analys\w*|meta analys\w*|umbrella review/
                          : /systematic review|umbrella review/;
      why = (ttl.match(pick)
          || ttl.match(/systematic review|meta-analys\w*|network meta\w*|umbrella review/) || [""])[0];
    }
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

  /* No design in the metadata — read the abstract instead.
     Each signal keeps the phrase that matched it, rather than letting whichever regex ran
     last set `why`. The card quotes that phrase, so the wrong one reads as a contradiction:
     a mouse study was coming back "Trial, inferred from the phrase mouse". */
  const grab = x => { const m = x.exec(txt); return m ? m[0].trim() : ""; };

  /* "randomised" on its own appears in any paper that discusses trials, and "participants
     were" appears in almost every human study. Both matched far too much. */
  const trialPhrase = grab(/\b(were|was) randomi[sz]ed|randomly (assigned|allocated)|randomi[sz]ed to|(double|single|triple)-blind|placebo-controlled|open-label,? randomi[sz]ed|phase (ii|iii|2|3) trial/);
  /* Text that talks about trials without being one. */
  const aboutPhrase = grab(/target trial emulation|propensity[- ]score|retrospective|real-world|compared with randomi[sz]ed trials|pooled analysis of/);
  const animalPhrase = grab(/\bmice\b|\bmouse\b|murine|\brats?\b|in vitro|cell lines?|ipsc|non-human primate|macaca|zebrafish|knockout|transgenic|preclinical|organoid/);
  /* Whether the subjects are people, which is a different question from whether anything
     was randomised. An animal study that randomises its animals is still an animal study. */
  const humanPhrase = grab(/\b(patients|participants|volunteers|outpatients|inpatients|adults|children|infants|neonates|women|men|pregnant)\b/);

  /* A protocol describes a trial that has not reported. Placing it at trial level puts a
     plan on the same row as a result, which is the opposite of what the grid is for. */
  const protoPhrase = (/\bprotocol\b|rationale and design/.test(ttl) ? (ttl.match(/\bprotocol\b|rationale and design/) || [""])[0] : "")
    || grab(/\b(participants|patients|we) will be (randomi[sz]ed|recruited|enrolled|allocated)|\bwill be randomly (assigned|allocated)|this protocol describes|statistical analysis plan/);
  if (protoPhrase && (trialPhrase || /trial/.test(txt)))
    return {design:"Trial protocol", tier:"narrative", src:"inferred", because: protoPhrase};

  if (animalPhrase && !humanPhrase)
    return {design: /in vitro|cell line|ipsc|organoid/.test(animalPhrase) ? "In vitro" : "Animal study",
            tier:"preclinical", src:"inferred", because: animalPhrase};
  if (trialPhrase && !aboutPhrase) return {design:"Trial", tier:"trial", src:"inferred", because: trialPhrase};
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

export function findN(r){
  const t = (r.abstractText || "");
  const m = t.match(/\bn\s*=\s*([\d,]{1,9})/i)
         || t.match(/([\d,]{2,9})\s+(?:patients|participants|subjects|individuals|adults|children|women|men)\b/i);
  if (!m) return null;
  const v = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(v) && v > 1 && v < 1e8 ? v : null;
}
/* Psychology records arrive from OpenAlex, which carries no publication types at all, so
   there is no metadata arm here: every answer is read off the text and every caller marks
   the result inferred. */
export function classifyPsy(title, abstract, type){
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
