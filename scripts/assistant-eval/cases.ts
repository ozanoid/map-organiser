/**
 * The eval's requests: things Ozan asks the assistant, in Turkish and
 * English, against his own library (ozan@maporganiser.com — London, Lisbon,
 * Istanbul; no plans, lists or visits yet) — or, where a case needs data his
 * library doesn't hold, the test account's (admin@maporganiser.com).
 *
 * Each case says which tools a good answer needs (one of each group), the
 * write it should propose (never run: the eval stops at the approval card,
 * or declines it), and the reply language; a case can add its own check of
 * the writes proposed.
 */

/** What a message is about, as a screen of the app sends it (a `<subject>`
 *  block) — named here, looked up in the case's library when it runs. */
export type TurnSubject = { kind: "plan"; name: string };

export type Turn =
  | { kind: "message"; text: string; subject?: TurnSubject }
  /** Answer the approval card with "no" to everything — the resume path,
   *  without writing anything. */
  | { kind: "decline" };

/** A write the model proposed (waiting for approval), as a check sees it. */
export interface ProposedWrite {
  name: string;
  input: unknown;
}

export interface EvalCase {
  id: string;
  lang: "tr" | "en";
  /** Whose library the case runs on: the owner's (default) or the test account's. */
  user?: "owner" | "test";
  turns: Turn[];
  /** Each inner list: at least one of these tools should be called. */
  expectTools: string[][];
  /** The write the model should propose (awaiting approval). */
  expectWrite?: string;
  /** The case's own check of the writes proposed: why it fails, or null. */
  check?: (proposed: ProposedWrite[]) => string | null;
  /** What a good answer does — for reading the transcripts. */
  note: string;
}

/** An update_plan call that sets the plan's start date. */
function movesPlanDate(write: ProposedWrite): boolean {
  if (write.name !== "update_plan") return false;
  const set = (write.input as { set?: Record<string, unknown> } | null)?.set;
  return !!set && Object.hasOwn(set, "start_date");
}

export const CASES: EvalCase[] = [
  {
    id: "trendy-solo",
    lang: "tr",
    turns: [
      {
        kind: "message",
        text: "Bu ay Londra'da tek başıma 3-4 trendy restoran denemek istiyorum. Yorumlara bak, en çok övülen tabakları söyle.",
      },
      { kind: "message", text: "İkincisi cumartesi öğlen açık mı, kalabalık olur mu?" },
    ],
    expectTools: [["rank_places", "search_places"], ["read_reviews", "get_places"]],
    note: "Picks 3–4 London places suited to a solo diner, names dishes from reviews; turn 2 checks Saturday noon hours and busyness with get_places at.",
  },
  {
    id: "kadikoy-brunch",
    lang: "tr",
    turns: [{ kind: "message", text: "Kadıköy'de cumartesi brunch için nereye gidebilirim?" }],
    expectTools: [["search_places", "rank_places"]],
    note: "Searches the Kadıköy places (mostly ocakbaşı); honest if few fit brunch; may offer a Google Maps search.",
  },
  {
    id: "visit-log",
    lang: "tr",
    turns: [{ kind: "message", text: "Dün Bolland & Crust'a gittim, 4 puan, pizza harikaydı." }],
    expectTools: [["search_places", "get_places"]],
    expectWrite: "log_visit",
    note: "Finds Bolland & Crust (London) and proposes log_visit for yesterday (2026-11-22), rating 4, the note in the user's words.",
  },
  {
    id: "maps-link-add",
    lang: "tr",
    turns: [
      {
        kind: "message",
        text: "Şunu kaydet: https://www.google.com/maps/place/Dishoom+Covent+Garden/@51.5124,-0.1269,17z",
      },
    ],
    expectTools: [],
    expectWrite: "add_places",
    note: "Proposes add_places with the Maps link (Dishoom isn't in the library).",
  },
  {
    id: "friday-plan",
    lang: "en",
    turns: [
      { kind: "message", text: "Plan Friday evening in Soho for two: dinner around 8, then a cocktail bar nearby." },
    ],
    expectTools: [["search_places", "rank_places"], ["get_places"]],
    expectWrite: "create_plan",
    note: "Finds a dinner place open Friday 20:00 and a nearby bar, lays the plan out and proposes create_plan (party of 2).",
  },
  {
    id: "laptop-cafe",
    lang: "en",
    turns: [{ kind: "message", text: "I need a quiet, laptop-friendly café in London for tomorrow at 10am." }],
    expectTools: [["rank_places", "search_places"]],
    note: "rank_places for quiet / laptop-friendly, open Tuesday 10:00.",
  },
  {
    id: "lisbon-dinner",
    lang: "en",
    turns: [
      {
        kind: "message",
        text: "Going to Lisbon next weekend — what are my best dinner options there, and what do reviewers rave about?",
      },
    ],
    // Since v1.49.0 rank_places carries review-derived pros and themes: the
    // dishes can come from those without another call (24.11.2026 run).
    expectTools: [["search_places", "rank_places"]],
    note: "Lisbon restaurants from the library (Ramiro, Zé da Mouraria, Taberna Sal Grosso…), dishes from reviews or rank_places' profiles.",
  },
  {
    id: "web-new-openings",
    lang: "tr",
    turns: [
      {
        kind: "message",
        text: "Londra'da son aylarda açılan, çok konuşulan restoranlar hangileri? Kütüphanemde olanlar var mı?",
      },
    ],
    expectTools: [["web_search"], ["search_places", "get_library_overview", "search_google_maps"]],
    note: "Uses web search (≤ 3) for new openings, checks which are saved, says the rest aren't in the library.",
  },
  {
    id: "romantic-list",
    lang: "tr",
    turns: [
      {
        kind: "message",
        text: "Romantik akşam yemekleri için bir liste hazırla: 5 mekan, her birine neden orada olduğu ve ne sipariş edileceği notuyla.",
      },
    ],
    expectTools: [["rank_places"], ["read_reviews", "get_places"]],
    expectWrite: "save_list",
    note: "rank_places for romantic, reviews for what to order, proposes save_list with Turkish notes.",
  },
  {
    id: "visits-history",
    lang: "en",
    turns: [{ kind: "message", text: "Where have I been recently, and what did I have?" }],
    expectTools: [["get_visits"]],
    note: "get_visits is empty: says no visits are logged yet, without inventing any.",
  },
  {
    id: "instagram-add",
    lang: "tr",
    turns: [{ kind: "message", text: "Bu posttaki mekanları ekle: https://www.instagram.com/p/DQx7aB2kLmN/" }],
    expectTools: [],
    expectWrite: "add_places",
    note: "Proposes add_places with instagram_url.",
  },
  {
    id: "decline-mark-visited",
    lang: "tr",
    turns: [
      { kind: "message", text: "Cervejaria Ramiro'yu gittim olarak işaretle, tarihini hatırlamıyorum." },
      { kind: "decline" },
    ],
    expectTools: [["search_places", "get_places"]],
    expectWrite: "update_places",
    note: "Proposes update_places (visited, no date); after the decline, acknowledges without retrying.",
  },
  {
    // The plan page's request, with the plan as subject. In the end-to-end run
    // of 25.11.2026 the model also moved this plan — whose days had passed —
    // to the coming Saturday, unasked. Since v1.55.0 the instructions keep a
    // plan's dates (Ozan's decision).
    id: "spread-plan-keeps-dates",
    lang: "tr",
    user: "test",
    turns: [
      {
        kind: "message",
        text: "Bu planı günlere dağıt: yakın yerleri aynı güne koy, kapalı oldukları günlere koyma.",
        subject: { kind: "plan", name: "Summer in London" },
      },
    ],
    expectTools: [["get_plans"]],
    check: (proposed) =>
      proposed.some(movesPlanDate) ? "update_plan changes the plan's start_date — the user didn't ask" : null,
    note: "The plan (from 20.07.2026, passed) keeps its dates: the stops are spread over its own days, or the reply says the dates have passed and asks — no start_date in update_plan.",
  },
];
