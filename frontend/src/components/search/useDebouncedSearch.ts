import { useState, useEffect } from "react";
import {
  getCollectionsSearch,
  getCompaniesSearch,
  getFilmSearch,
  getPeopleSearch,
} from "@/api/public";
import type {
  CollectionSearchItem,
  CompanySearchItem,
  FilmIndexItem,
  PersonSearchItem,
} from "@/api/types";
import { arcStageLabel } from "@/components/film/labels";
import { franchisePath, personPath, studioPath } from "@/lib/film-entities";

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;

/** How many hits each group shows. Five rather than the old flat eight because four groups of
 *  eight is a dropdown the reader has to scroll past to learn the other three exist. */
const GROUP_LIMIT = 5;

type SearchStatus = "idle" | "loading" | "success" | "error";

/** The four things the header finds. The keys are the code's words (`company`, `franchise`);
 *  the labels below are the reader's (EF-19). */
export type SearchGroupKey = "film" | "person" | "company" | "franchise";

/** One row of the dropdown, flattened so the row component renders a hit from any of the four
 *  endpoints without branching on which produced it. */
export interface SearchHit {
  /** Unique within the dropdown — the same TMDB id can appear under two groups. */
  key: string;
  label: string;
  /** The entity's own page. */
  to: string;
  imagePath: string | null;
  /** Which TMDB image family `imagePath` belongs to, so the row sizes and shapes it right. */
  imageKind: "poster" | "profile" | "logo";
  /** The trailing detail beside the name — a year, a department, a country — or null. */
  detail: string | null;
}

export interface SearchGroup {
  key: SearchGroupKey;
  label: string;
  items: SearchHit[];
  /** This group's own request failed. Kept apart from an empty `items` because the two must
   *  not look the same on screen: a group that found nothing is silent, but a group that
   *  could not be asked has to say so rather than imply the catalog holds no match. */
  failed: boolean;
}

/** One group's fetch, already flattened to {@link SearchHit}s. Bound as a pair (endpoint +
 *  normaliser) for the same reason `api/entities.ts` does it: a `Record` of the two halves
 *  apart cannot prove the company normaliser is never handed a person. */
type GroupSearch = (baseUrl: string, q: string, signal: AbortSignal) => Promise<SearchHit[]>;

function bind<T>(
  fetcher: (
    baseUrl: string,
    q: string,
    opts?: { limit?: number; signal?: AbortSignal },
  ) => Promise<{ items: T[] }>,
  normalise: (item: T) => SearchHit,
): GroupSearch {
  return async (baseUrl, q, signal) => {
    const res = await fetcher(baseUrl, q, { limit: GROUP_LIMIT, signal });
    return res.items.slice(0, GROUP_LIMIT).map(normalise);
  };
}

/** Group order is the spec's, and fixed: the backend ranks within a type and not across them,
 *  so there is no honest way to interleave the four (EF-17, and `FollowEntitySearch` chose
 *  tabs over one list for the same reason). */
const GROUPS: { key: SearchGroupKey; label: string; search: GroupSearch }[] = [
  {
    key: "film",
    label: "Films",
    search: bind(getFilmSearch, (item: FilmIndexItem) => ({
      key: `film-${item.ref}`,
      label: item.title,
      to: `/film/${item.ref}`,
      imagePath: item.poster_path,
      imageKind: "poster",
      detail:
        item.release_year !== null ? String(item.release_year) : arcStageLabel(item.arc_stage),
    })),
  },
  {
    key: "person",
    label: "People",
    search: bind(getPeopleSearch, (item: PersonSearchItem) => ({
      key: `person-${item.id}`,
      label: item.name,
      to: personPath(item.id, item.name),
      imagePath: item.profile_path,
      imageKind: "profile",
      detail: item.known_for_department,
    })),
  },
  {
    key: "company",
    label: "Studios",
    search: bind(getCompaniesSearch, (item: CompanySearchItem) => ({
      key: `company-${item.id}`,
      label: item.name,
      to: studioPath(item.id, item.name),
      imagePath: item.logo_path,
      imageKind: "logo",
      detail: item.origin_country,
    })),
  },
  {
    key: "franchise",
    label: "Franchises",
    search: bind(getCollectionsSearch, (item: CollectionSearchItem) => ({
      key: `franchise-${item.id}`,
      label: item.name,
      to: franchisePath(item.id, item.name),
      imagePath: item.poster_path,
      imageKind: "poster",
      detail: null,
    })),
  },
];

/**
 * One debounced query, four requests, four groups.
 *
 * `groups` is null until a query has been answered, then holds the groups that found something
 * plus any whose request failed — a group that was asked and had no hits is dropped, so an
 * empty array means the query matched nothing anywhere.
 *
 * A group whose request fails does not take the other three down with it; `status` goes to
 * `"error"` only when all four failed, which is the case where there is no dropdown worth
 * opening rather than a partial one.
 */
export function useDebouncedSearch(q: string, baseUrl: string) {
  const [groups, setGroups] = useState<SearchGroup[] | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");

  useEffect(() => {
    if (q.length < MIN_QUERY_LEN) {
      // Reset internal state so stale results don't flash when the query comes
      // back above the minimum length before the debounce fires.
      setGroups(null); // eslint-disable-line react-hooks/set-state-in-effect
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      const settled = await Promise.allSettled(
        GROUPS.map((group) => group.search(baseUrl, q, controller.signal)),
      );
      if (controller.signal.aborted) return;

      if (settled.every((r) => r.status === "rejected")) {
        setGroups(null);
        setStatus("error");
        return;
      }

      setGroups(
        GROUPS.map((group, i) => {
          const result = settled[i];
          return {
            key: group.key,
            label: group.label,
            items: result.status === "fulfilled" ? result.value : [],
            failed: result.status === "rejected",
          };
        }).filter((group) => group.items.length > 0 || group.failed),
      );
      setStatus("success");
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, baseUrl]);

  return { groups, status };
}
