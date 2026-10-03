import { describe, expect, it } from "vitest";
import {
  ENTITY_UPDATE_TYPE_MAP,
  ENTITY_UPDATE_TYPES,
  MAX_DAY_POSTERS,
  dayPosterLeads,
  groupByDay,
  groupByEntity,
  groupByFollowBlock,
  UPDATE_TYPES,
  groupByUpdateType,
  groupEventsByDay,
  rowKey,
  splitByNewsBacked,
} from "@/lib/feed-groups";
import type { FeedDayItem, FeedVia, FilmEvent } from "@/api/types";

function item(day: string, film_ref: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_ref,
    film_title: film_ref.toUpperCase(),
    release_year: 2026,
    poster_path: null,
    arc_stage: "shooting",
    production_countries: [],
    directors: [],
    day,
    top_event_type: "casting",
    event_types: ["casting"],
    event_count: 1,
    news_backed: false,
    events: [],
    ...overrides,
  };
}

describe("groupByDay", () => {
  it("returns an empty array for no items", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets same-day items into one group, preserving input order", () => {
    const groups = groupByDay([item("2026-06-23", "a"), item("2026-06-23", "b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].items.map((i) => i.film_ref)).toEqual(["a", "b"]);
  });

  it("opens a new group on a day boundary, keeping groups newest-first", () => {
    const groups = groupByDay([
      item("2026-06-23", "a"),
      item("2026-06-23", "b"),
      item("2026-06-22", "c"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items.map((i) => i.film_ref)).toEqual(["c"]);
    expect(groups[1].heading).toContain("June 22, 2026");
  });
});

describe("splitByNewsBacked", () => {
  it("returns two empty lists for no items", () => {
    expect(splitByNewsBacked([])).toEqual({ newsBacked: [], tmdbOnly: [] });
  });

  it("sorts alphabetically within each bucket", () => {
    // Interleaved on input: the split sorts by title (case-insensitive) within each bucket.
    const { newsBacked, tmdbOnly } = splitByNewsBacked([
      item("2026-06-23", "z-film", { news_backed: true, film_title: "Z Film" }),
      item("2026-06-23", "a-film", { film_title: "Alpha Film" }),
      item("2026-06-23", "m-film", { news_backed: true, film_title: "M Film" }),
      item("2026-06-23", "b-film", { film_title: "Bravo Film" }),
    ]);
    expect(newsBacked.map((i) => i.film_ref)).toEqual(["m-film", "z-film"]);
    expect(tmdbOnly.map((i) => i.film_ref)).toEqual(["a-film", "b-film"]);
  });

  it("puts every item in one bucket when the day is all news-backed", () => {
    const { newsBacked, tmdbOnly } = splitByNewsBacked([
      item("2026-06-23", "a", { news_backed: true }),
      item("2026-06-23", "b", { news_backed: true }),
    ]);
    expect(newsBacked).toHaveLength(2);
    expect(tmdbOnly).toEqual([]);
  });

  it("puts every item in one bucket when the day is all TMDB-only", () => {
    const { newsBacked, tmdbOnly } = splitByNewsBacked([
      item("2026-06-23", "a"),
      item("2026-06-23", "b"),
    ]);
    expect(newsBacked).toEqual([]);
    expect(tmdbOnly).toHaveLength(2);
  });

  it("sorts by natural English title ignoring leading A, An, The", () => {
    const items = [
      item("2026-06-23", "the-batman", { news_backed: true, film_title: "The Batman" }),
      item("2026-06-23", "an-american", { news_backed: true, film_title: "An American in Paris" }),
      item("2026-06-23", "a-clockwork", { news_backed: true, film_title: "A Clockwork Orange" }),
      item("2026-06-23", "batman", { news_backed: true, film_title: "Batman" }),
      item("2026-06-23", "avengers", { news_backed: true, film_title: "Avengers" }),
    ];
    const { newsBacked } = splitByNewsBacked(items);
    // Natural sort keys:
    //   "An American in Paris" → "american in paris"
    //   "Avengers"            → "avengers"
    //   "Batman"              → "batman"
    //   "The Batman"          → "batman" (tie with "Batman" → localeCompare original: B < T)
    //   "A Clockwork Orange"  → "clockwork orange"
    expect(newsBacked.map((i) => i.film_ref)).toEqual([
      "an-american",
      "avengers",
      "batman",
      "the-batman",
      "a-clockwork",
    ]);
  });

  it("keeps every input item — the split partitions, it never drops or caps", () => {
    const items = Array.from({ length: 74 }, (_, n) =>
      item("2026-08-11", `film-${n}`, { news_backed: n % 3 === 0 }),
    );
    const { newsBacked, tmdbOnly } = splitByNewsBacked(items);
    expect(newsBacked.length + tmdbOnly.length).toBe(74);
  });
});

function event(created_at: string, summary: string): FilmEvent {
  return {
    event_id: "evt-default",
    event_type: "casting",
    confidence: "confirmed",
    created_at,
    occurred_at: created_at,
    summary,
    summary_edited: false,
    status: "published",
    superseded_by: null,
    video_key: null,
    provenance: "story",
    sources: [],
  };
}

describe("groupEventsByDay", () => {
  it("returns an empty array for no events", () => {
    expect(groupEventsByDay([])).toEqual([]);
  });

  it("orders days newest-first and events newest-first within a day", () => {
    // Input is ascending by created_at, as the backend returns it.
    const groups = groupEventsByDay([
      event("2026-06-22T08:00:00Z", "older day"),
      event("2026-06-23T08:00:00Z", "same day, earlier"),
      event("2026-06-23T20:00:00Z", "same day, later"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].events.map((e) => e.summary)).toEqual([
      "same day, later",
      "same day, earlier",
    ]);
    expect(groups[1].events.map((e) => e.summary)).toEqual(["older day"]);
  });

  it("derives the UTC day key and human heading from created_at", () => {
    const groups = groupEventsByDay([event("2026-06-23T23:30:00Z", "late evening UTC")]);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].heading).toContain("June 23, 2026");
  });
});

describe("dayPosterLeads", () => {
  /** Local helper: unlike the shared `item`, these default to *having* a poster. */
  function poster(film_ref: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
    return item("2026-06-23", film_ref, { poster_path: `/${film_ref}.jpg`, ...overrides });
  }

  it("puts news-backed films ahead of TMDB-only ones, alphabetically within each kind", () => {
    // Backend order within a day is by popularity, so the two kinds arrive interleaved.
    const leads = dayPosterLeads([
      poster("primetime"),
      poster("animals", { news_backed: true }),
      poster("dorothy"),
      poster("charlie", { news_backed: true }),
    ]);
    // News-backed first, alphabetically: animals then charlie. Then TMDB-only: dorothy then primetime.
    expect(leads.map((i) => i.film_ref)).toEqual(["animals", "charlie", "dorothy", "primetime"]);
  });

  it("partitions alphabetically within each kind", () => {
    const leads = dayPosterLeads([
      poster("less-popular", { news_backed: true }),
      poster("popular", { news_backed: true }),
    ]);
    // Alphabetical: less-popular before popular
    expect(leads.map((i) => i.film_ref)).toEqual(["less-popular", "popular"]);
  });

  it("drops films with no poster rather than holding a blank slot", () => {
    const leads = dayPosterLeads([
      poster("no-poster", { news_backed: true, poster_path: null }),
      poster("has-poster"),
    ]);
    expect(leads.map((i) => i.film_ref)).toEqual(["has-poster"]);
  });

  it("caps the strip so a backfill day does not load dozens of images", () => {
    const many = Array.from({ length: 40 }, (_, i) => poster(`film-${i}`));
    expect(dayPosterLeads(many)).toHaveLength(MAX_DAY_POSTERS);
  });

  it("returns nothing for a day whose films all lack posters", () => {
    expect(dayPosterLeads([poster("x", { poster_path: null })])).toEqual([]);
  });

  it("deduplicates same film appearing in both news and TMDB sections", () => {
    const leads = dayPosterLeads([poster("batman", { news_backed: true }), poster("batman")]);
    expect(leads).toHaveLength(1);
    expect(leads[0].film_ref).toBe("batman");
    expect(leads[0].news_backed).toBe(true);
  });

  it("keeps first (news-backed) copy of a film in both sections", () => {
    const leads = dayPosterLeads([
      poster("batman", { news_backed: true }),
      poster("batman"),
      poster("superman", { news_backed: true }),
      poster("superman"),
    ]);
    expect(leads.map((i) => i.film_ref)).toEqual(["batman", "superman"]);
    expect(leads.every((i) => i.news_backed)).toBe(true);
  });

  it("does not affect distinct films", () => {
    const leads = dayPosterLeads([poster("a"), poster("b"), poster("c")]);
    expect(leads.map((i) => i.film_ref)).toEqual(["a", "b", "c"]);
  });

  it("caps after dedup", () => {
    const items = Array.from({ length: 20 }, (_, i) => poster(`film-${i % 8}`));
    expect(dayPosterLeads(items)).toHaveLength(8);
  });
});

describe("groupByUpdateType", () => {
  function typed(event_id: string, event_type: string, overrides: Partial<FilmEvent> = {}) {
    return { ...event("2026-06-23T10:00:00Z", event_id), event_id, event_type, ...overrides };
  }

  function row(film_ref: string, ...events: FilmEvent[]): FeedDayItem {
    const types = [...new Set(events.map((e) => e.event_type))];
    return item("2026-06-23", film_ref, { events, event_types: types, top_event_type: types[0] });
  }

  /** `[heading, [film, [event ids]]]` — the shape a reader sees, without the payloads. */
  function outline(items: FeedDayItem[]) {
    return groupByUpdateType(items).map((group) => [
      group.label,
      group.rows.map((r) => [r.item.film_ref, r.events.map((e) => e.event_id)]),
    ]);
  }

  it("pins the heading order as a literal (NR-3)", () => {
    // Not derivable from the backend's `_EVENT_STAGE`: Crew, Studios and Franchise tie at
    // `announced`, and `canceled` outranks everything yet files under Production status.
    expect(UPDATE_TYPES).toEqual([
      "now_available",
      "trailer",
      "release_date",
      "production_status",
      "cast",
      "crew",
      "studios",
      "franchise",
      "other",
    ]);
  });

  it("files every mapped event_type under its heading, in the fixed order", () => {
    const types = [
      "collection_removed",
      "collection_attached",
      "company_removed",
      "company_attached",
      "crew_removed",
      "crew_attached",
      "cast_removed",
      "casting",
      "canceled",
      "production_wrap",
      "production_start",
      "release_date",
      "trailer",
      "now_available",
    ];
    const items = types.map((t) => row(t, typed(t, t)));
    expect(outline(items)).toEqual([
      ["Now available", [["now_available", ["now_available"]]]],
      ["Trailer", [["trailer", ["trailer"]]]],
      ["Release date", [["release_date", ["release_date"]]]],
      [
        "Production status",
        [
          ["canceled", ["canceled"]],
          ["production_wrap", ["production_wrap"]],
          ["production_start", ["production_start"]],
        ],
      ],
      [
        "Cast",
        [
          ["cast_removed", ["cast_removed"]],
          ["casting", ["casting"]],
        ],
      ],
      [
        "Crew",
        [
          ["crew_removed", ["crew_removed"]],
          ["crew_attached", ["crew_attached"]],
        ],
      ],
      [
        "Studios",
        [
          ["company_removed", ["company_removed"]],
          ["company_attached", ["company_attached"]],
        ],
      ],
      [
        "Franchise",
        [
          ["collection_removed", ["collection_removed"]],
          ["collection_attached", ["collection_attached"]],
        ],
      ],
    ]);
  });

  it("files any unmapped type under a trailing Other updates heading", () => {
    // `credit_removed` lands here between a frontend deploy and the backend migration (NR-12),
    // and the story-only `announced` / `first_look` would if they ever reached this section.
    const items = [
      row("old", typed("e1", "credit_removed")),
      row("story", typed("e2", "first_look")),
      row("cast", typed("e3", "casting")),
      // Not a key a plain-object lookup would miss: an inherited property must not map.
      row("proto", typed("e4", "constructor")),
    ];
    expect(outline(items)).toEqual([
      ["Cast", [["cast", ["e3"]]]],
      [
        "Other updates",
        [
          ["old", ["e1"]],
          ["story", ["e2"]],
          ["proto", ["e4"]],
        ],
      ],
    ]);
  });

  it("lists a two-type film under both headings, each row holding only that heading's events", () => {
    const blade = row(
      "blade",
      typed("cast-1", "casting"),
      typed("start", "production_start"),
      typed("cast-2", "cast_removed"),
    );
    expect(outline([blade])).toEqual([
      ["Production status", [["blade", ["start"]]]],
      ["Cast", [["blade", ["cast-1", "cast-2"]]]],
    ]);
    // The row carries the whole item, so it can render the film's full header.
    expect(groupByUpdateType([blade])[0].rows[0].item).toBe(blade);
  });

  it("keeps the input order of films under a heading and of events within a row", () => {
    // The caller hands in `splitByNewsBacked`'s natural-title order; the grouping is stable.
    const items = [
      row("a-film", typed("a2", "casting"), typed("a1", "casting")),
      row("m-film", typed("m1", "casting")),
      row("z-film", typed("z1", "release_date"), typed("z2", "casting")),
    ];
    expect(outline(items)).toEqual([
      ["Release date", [["z-film", ["z1"]]]],
      [
        "Cast",
        [
          ["a-film", ["a2", "a1"]],
          ["m-film", ["m1"]],
          ["z-film", ["z2"]],
        ],
      ],
    ]);
  });

  it("files a no-events fallback row under each of its event_types, with no event lines", () => {
    const fallback = item("2026-06-23", "old-backend", {
      events: [],
      event_types: ["casting", "cast_removed", "trailer"],
    });
    expect(outline([fallback])).toEqual([
      ["Trailer", [["old-backend", []]]],
      ["Cast", [["old-backend", []]]],
    ]);
  });

  it("never reads news_backed, and keeps an event's sources", () => {
    const source = { url: "https://x.test/1", source: "X", title: "One", published_at: null };
    const reported = {
      ...row("reported", typed("e1", "trailer", { sources: [source] })),
      news_backed: true,
    };
    const [group] = groupByUpdateType([reported]);
    expect(group.key).toBe("trailer");
    expect(group.rows[0].events[0].sources).toEqual([source]);
  });

  it("returns no headings for no items", () => {
    expect(groupByUpdateType([])).toEqual([]);
  });
});

function via(
  entity_type: FeedVia["entity_type"],
  entity_id: string,
  name: string | null = `${entity_type} ${entity_id}`,
): FeedVia {
  return { entity_type, entity_id, name, ref: name === null ? null : `${entity_id}-slug` };
}

function typedEvent(event_id: string, event_type = "casting"): FilmEvent {
  return { ...event("2026-06-23T10:00:00Z", event_id), event_id, event_type };
}

/** A timeline row for `film_ref` reached through `reach` (null: a title row). */
function reached(
  film_ref: string,
  reach: FeedVia | null,
  events: FilmEvent[] = [typedEvent(`${film_ref}-e`)],
  overrides: Partial<FeedDayItem> = {},
): FeedDayItem {
  const types = [...new Set(events.map((e) => e.event_type))];
  return item("2026-06-23", film_ref, {
    via: reach,
    events,
    event_types: types,
    top_event_type: types[0],
    ...overrides,
  });
}

describe("groupByFollowBlock", () => {
  function outline(items: FeedDayItem[]) {
    return groupByFollowBlock(items).map((block) => [
      block.key,
      block.label,
      block.items.map((i) => i.film_ref),
    ]);
  }

  it("lays the blocks out Films, People, Studios, Franchises whatever order the rows arrive in", () => {
    const items = [
      reached("f1", via("franchise", "10")),
      reached("s1", via("company", "20")),
      reached("p1", via("person", "30")),
      reached("t1", null),
    ];
    expect(outline(items)).toEqual([
      ["films", "Films", ["t1"]],
      ["people", "People", ["p1"]],
      ["studios", "Studios", ["s1"]],
      ["franchises", "Franchises", ["f1"]],
    ]);
  });

  it("omits a block with no rows", () => {
    const items = [reached("p1", via("person", "30")), reached("f1", via("franchise", "10"))];
    expect(outline(items)).toEqual([
      ["people", "People", ["p1"]],
      ["franchises", "Franchises", ["f1"]],
    ]);
  });

  it("files a row without a via field — an older backend — under Films (FB-9)", () => {
    // `item` builds a row with no `via` key at all, as a pre-FB-12 backend ships it.
    const legacy = item("2026-06-23", "legacy");
    expect("via" in legacy).toBe(false);
    expect(outline([legacy, reached("titled", null)])).toEqual([
      ["films", "Films", ["legacy", "titled"]],
    ]);
  });

  it("keeps the input order within a block", () => {
    const items = [
      reached("b", via("person", "1")),
      reached("a", via("person", "2")),
      reached("c", via("person", "1")),
    ];
    expect(outline(items)).toEqual([["people", "People", ["b", "a", "c"]]]);
  });

  it("returns no blocks for no items", () => {
    expect(groupByFollowBlock([])).toEqual([]);
  });
});

describe("groupByEntity", () => {
  /** `[entity key, [[film, event id]]]` — what a reader sees, without the payloads. */
  function outline(items: FeedDayItem[]) {
    return groupByEntity(items).map((row) => [
      row.key,
      row.lines.map((line) => [line.item.film_ref, line.event.event_id]),
    ]);
  }

  it("merges one entity's rows across films into one row, its lines tagged by film", () => {
    const villeneuve = via("person", "137427", "Denis Villeneuve");
    const dune = reached("dune", villeneuve, [typedEvent("d1"), typedEvent("d2", "crew_attached")]);
    const rama = reached("rama", villeneuve, [typedEvent("r1", "crew_attached")]);
    const rows = groupByEntity([dune, rama]);
    expect(rows).toHaveLength(1);
    expect(rows[0].via).toEqual(villeneuve);
    expect(outline([dune, rama])).toEqual([
      [
        "person:137427",
        [
          ["dune", "d1"],
          ["dune", "d2"],
          ["rama", "r1"],
        ],
      ],
    ]);
    // A line carries its whole row, so it can render the film's title and parenthetical.
    expect(rows[0].lines[2].item).toBe(rama);
  });

  it("orders lines by the film's natural title, then the backend's event order", () => {
    const pugh = via("person", "1373737", "Florence Pugh");
    const items = [
      reached("zebra", pugh, [typedEvent("z1")], { film_title: "Zebra" }),
      reached("the-banana", pugh, [typedEvent("b2"), typedEvent("b1")], {
        film_title: "The Banana",
      }),
      reached("apple", pugh, [typedEvent("a1")], { film_title: "apple" }),
    ];
    expect(outline(items)).toEqual([
      [
        "person:1373737",
        [
          ["apple", "a1"],
          ["the-banana", "b2"],
          ["the-banana", "b1"],
          ["zebra", "z1"],
        ],
      ],
    ]);
  });

  it("sorts people by name as written, casefolded, with no article stripping", () => {
    const items = [
      reached("x", via("person", "1", "The Rock")),
      reached("x", via("person", "2", "zendaya")),
      reached("x", via("person", "3", "Anya Taylor-Joy")),
      reached("x", via("person", "4", "billie piper")),
    ];
    // "The Rock" sorts under T, not R.
    expect(groupByEntity(items).map((row) => row.via.name)).toEqual([
      "Anya Taylor-Joy",
      "billie piper",
      "The Rock",
      "zendaya",
    ]);
  });

  it("sorts studios and franchises by the natural title sort", () => {
    const items = [
      reached("x", via("company", "1", "Legendary Pictures")),
      reached("x", via("company", "2", "The Apple Studio")),
      reached("x", via("company", "3", "a24")),
    ];
    expect(groupByEntity(items).map((row) => row.via.name)).toEqual([
      "a24",
      "The Apple Studio",
      "Legendary Pictures",
    ]);
    const franchises = [
      reached("x", via("franchise", "1", "The Matrix Collection")),
      reached("x", via("franchise", "2", "Dune Collection")),
    ];
    expect(groupByEntity(franchises).map((row) => row.via.name)).toEqual([
      "Dune Collection",
      "The Matrix Collection",
    ]);
  });

  it("breaks a tie on name by entity_id", () => {
    const items = [
      reached("x", via("person", "2", "Chris Evans")),
      reached("y", via("person", "1", "chris evans")),
    ];
    expect(groupByEntity(items).map((row) => row.key)).toEqual(["person:1", "person:2"]);
  });

  it("puts an entity the catalog cannot name after every named one (FB-10)", () => {
    const items = [
      reached("x", via("person", "1", null)),
      reached("y", via("person", "2", "Zendaya")),
    ];
    expect(groupByEntity(items).map((row) => row.key)).toEqual(["person:2", "person:1"]);
  });

  it("keeps two entity types that share an id apart", () => {
    const items = [reached("a", via("person", "7")), reached("b", via("company", "7"))];
    expect(outline(items).map(([key]) => key)).toEqual(["company:7", "person:7"]);
  });

  it("skips title rows, and an entity left with no lines", () => {
    const noEvents = reached("fallback", via("person", "1"), [], { event_types: ["casting"] });
    expect(groupByEntity([reached("t", null), item("2026-06-23", "legacy"), noEvents])).toEqual([]);
  });

  it("groups one update type's rows, each entity holding only that heading's lines", () => {
    // The entity block's Not yet reported: update type first, then entity rows under it (FB-6).
    const ramsay = via("person", "5602", "Lynne Ramsay");
    const items = [
      reached(
        "b-film",
        ramsay,
        [typedEvent("b-join", "casting"), typedEvent("b-end", "canceled")],
        {
          film_title: "Banana",
        },
      ),
      reached("a-film", ramsay, [typedEvent("a-join", "crew_attached")], { film_title: "Apple" }),
    ];
    const byType = groupByUpdateType(items, ENTITY_UPDATE_TYPE_MAP).map((group) => [
      group.key,
      groupByEntity(group.rows).map((row) => [
        row.key,
        row.lines.map((line) => [line.item.film_ref, line.event.event_id]),
      ]),
    ]);
    expect(byType).toEqual([
      [
        "attached",
        [
          [
            "person:5602",
            [
              ["a-film", "a-join"],
              ["b-film", "b-join"],
            ],
          ],
        ],
      ],
      ["canceled", [["person:5602", [["b-film", "b-end"]]]]],
    ]);
  });
});

describe("groupByUpdateType with the entity map", () => {
  function outline(items: FeedDayItem[]) {
    return groupByUpdateType(items, ENTITY_UPDATE_TYPE_MAP).map((group) => [
      group.label,
      group.rows.map((r) => [r.item.film_ref, r.events.map((e) => e.event_id)]),
    ]);
  }

  it("pins the heading order as a literal (FB-4)", () => {
    expect(ENTITY_UPDATE_TYPES).toEqual(["attached", "detached", "canceled", "other"]);
  });

  it("files every mapped event_type under its heading, in the fixed order", () => {
    const types = [
      "canceled",
      "collection_removed",
      "company_removed",
      "crew_removed",
      "cast_removed",
      "collection_attached",
      "company_attached",
      "crew_attached",
      "casting",
    ];
    const reach = via("person", "1");
    const items = types.map((t) => reached(t, reach, [typedEvent(t, t)]));
    expect(outline(items)).toEqual([
      [
        "Attached",
        [
          ["collection_attached", ["collection_attached"]],
          ["company_attached", ["company_attached"]],
          ["crew_attached", ["crew_attached"]],
          ["casting", ["casting"]],
        ],
      ],
      [
        "Detached",
        [
          ["collection_removed", ["collection_removed"]],
          ["company_removed", ["company_removed"]],
          ["crew_removed", ["crew_removed"]],
          ["cast_removed", ["cast_removed"]],
        ],
      ],
      ["Canceled", [["canceled", ["canceled"]]]],
    ]);
  });

  it("files any other type — the film map's included — under a trailing Other updates", () => {
    const reach = via("company", "1");
    const items = [
      reached("trailer", reach, [typedEvent("e1", "trailer")]),
      reached("start", reach, [typedEvent("e2", "production_start")]),
      reached("joins", reach, [typedEvent("e3", "company_attached")]),
      reached("proto", reach, [typedEvent("e4", "constructor")]),
    ];
    expect(outline(items)).toEqual([
      ["Attached", [["joins", ["e3"]]]],
      [
        "Other updates",
        [
          ["trailer", ["e1"]],
          ["start", ["e2"]],
          ["proto", ["e4"]],
        ],
      ],
    ]);
  });

  it("splits one film's events between the entity headings", () => {
    const row = reached("cleopatra", via("person", "1"), [
      typedEvent("join", "crew_attached"),
      typedEvent("end", "canceled"),
    ]);
    const groups = groupByUpdateType([row], ENTITY_UPDATE_TYPE_MAP);
    expect(groups.map((g) => [g.key, g.rows[0].events.map((e) => e.event_id)])).toEqual([
      ["attached", ["join"]],
      ["canceled", ["end"]],
    ]);
  });
});

describe("rowKey", () => {
  it("keys a row by its reach and film (FB-9)", () => {
    expect(rowKey(reached("dune", null))).toBe("title:dune");
    expect(rowKey(item("2026-06-23", "dune"))).toBe("title:dune");
    expect(rowKey(reached("dune", via("person", "137427")))).toBe("person:137427:dune");
    expect(rowKey(reached("dune", via("company", "923")))).toBe("company:923:dune");
  });
});
