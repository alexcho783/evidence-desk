/* Evidence Desk — appraisal Edge Function.
 *
 * Takes a question and the papers a search returned, and asks Gemini what each one says
 * about the question, plus a short verdict. Runs on Supabase Edge Functions so the API key
 * stays server-side; the browser never sees it.
 *
 * Deliberately narrow: this does NOT classify study design. That comes from the publication
 * types Europe PMC carries over from MEDLINE, which are assigned by human indexers and are
 * more reliable than anything a model would infer. The model only adds what metadata cannot
 * provide — which way a paper points, and a synthesis across them. Keeping the division
 * there means a bad model answer cannot corrupt the part of the page that already works.
 *
 * Deploy: Supabase dashboard → Edge Functions → Deploy a new function → paste this in.
 * Then add a secret named GEMINI_API_KEY. Setup is in README.md.
 */

import { GoogleGenAI } from "npm:@google/genai@2.30.0";

/* Who may call this. The deployed site, plus localhost for testing against a local copy. */
const ALLOWED_ORIGINS = [
  "https://alexcho783.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

/* Cost and abuse are bounded here, not in the browser, because the browser can lie. */
const MAX_PAPERS = 20;
const MAX_ABSTRACT = 1200;
const MAX_QUESTION = 300;

const MODEL = "gemini-3.6-flash";

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string" },
    certainty: { type: "string", enum: ["low", "moderate", "high"] },
    papers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          stance: { type: "string", enum: ["supports", "mixed", "against", "unrelated"] },
          takeaway: { type: "string" },
        },
        required: ["i", "stance", "takeaway"],
      },
    },
  },
  required: ["verdict", "certainty", "papers"],
};

const INSTRUCTIONS =
`You appraise biomedical literature. You are given a question and numbered paper records
(title, journal, year, abstract). Answer only from those records.

For each record give:
- stance: how it bears on the question as asked — "supports", "mixed", "against", or
  "unrelated" for a paper that does not address it. Stance is about what the paper found,
  not whether the study is good.
- takeaway: at most 18 words, the finding as the abstract states it.

Then write:
- verdict: 2 to 3 sentences of plain clinical English answering the question from these
  abstracts. Name the strongest evidence and the main uncertainty. Never invent a study,
  a number or a citation. If the records do not answer the question, say so plainly.
- certainty: "high" only where consistent findings come from syntheses or trials;
  "low" where the evidence is preclinical, single-study, or conflicting.

You are reading abstracts, not full papers. Be careful in proportion to that.`;

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405, origin);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    return reply({ error: "not_configured", message: "Appraisal isn't configured on this site." }, 503, origin);
  }

  let payload: { question?: unknown; papers?: unknown };
  try {
    payload = await req.json();
  } catch {
    return reply({ error: "bad_request", message: "Expected a JSON body." }, 400, origin);
  }

  const question = String(payload.question ?? "").trim().slice(0, MAX_QUESTION);
  const raw = Array.isArray(payload.papers) ? payload.papers : [];
  if (!question || !raw.length) {
    return reply({ error: "bad_request", message: "Send a question and at least one paper." }, 400, origin);
  }

  const papers = raw.slice(0, MAX_PAPERS).map((p: Record<string, unknown>, idx: number) => ({
    i: idx + 1,
    title: String(p?.title ?? "").slice(0, 300),
    journal: String(p?.journal ?? "").slice(0, 120),
    year: Number(p?.year) || null,
    abstract: String(p?.abstract ?? "").slice(0, MAX_ABSTRACT),
  }));

  const records = papers
    .map((p) => `[${p.i}] ${p.title} — ${p.journal || "journal n/a"}, ${p.year ?? "year n/a"}\n${p.abstract || "(no abstract available)"}`)
    .join("\n\n");

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const interaction = await ai.interactions.create({
      model: MODEL,
      input: `${INSTRUCTIONS}\n\nQUESTION: ${question}\n\nRECORDS:\n${records}`,
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
    });

    const text = interaction.output_text;
    if (!text) {
      /* Usually a safety filter rather than a fault — medical text trips them occasionally. */
      return reply(
        { error: "no_output", message: "The appraisal service returned nothing for that question." },
        502, origin,
      );
    }

    let parsed: { verdict?: string; certainty?: string; papers?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      return reply({ error: "unparseable", message: "The appraisal came back in an unusable shape." }, 502, origin);
    }
    if (!parsed || typeof parsed.verdict !== "string" || !Array.isArray(parsed.papers)) {
      return reply({ error: "unparseable", message: "The appraisal came back incomplete." }, 502, origin);
    }

    return reply(
      {
        verdict: parsed.verdict,
        certainty: ["low", "moderate", "high"].includes(String(parsed.certainty)) ? parsed.certainty : "low",
        papers: parsed.papers,
        model: MODEL,
      },
      200, origin,
    );
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes("quota") || msg.includes("rate") || msg.includes("429")) {
      return reply(
        { error: "rate_limited", message: "The free appraisal quota is used up for now. It resets daily." },
        429, origin,
      );
    }
    if (msg.includes("api key") || msg.includes("401") || msg.includes("403")) {
      return reply({ error: "auth", message: "The appraisal service rejected this site's credentials." }, 502, origin);
    }
    return reply({ error: "upstream", message: "The appraisal service could not be reached." }, 502, origin);
  }
});
