import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Outlet, createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { headerSearchHandlers } from "@/test/msw/search";
import { SearchBox } from "@/components/search/SearchBox";
import type {
  CollectionSearchItem,
  CompanySearchItem,
  FilmIndexItem,
  PersonSearchItem,
} from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sampleFilm: FilmIndexItem = {
  ref: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "wrapped",
};

const samplePerson: PersonSearchItem = {
  id: 525,
  name: "Christopher Nolan",
  known_for_department: "Directing",
  profile_path: "/nolan.jpg",
};

const sampleCompany: CompanySearchItem = {
  id: 41,
  name: "A24",
  logo_path: "/a24.png",
  origin_country: "US",
};

const sampleCollection: CollectionSearchItem = {
  id: 10,
  name: "Star Wars Collection",
  poster_path: "/sw.jpg",
};

/** Every type finds something — the dropdown at its fullest. */
const allFour = () =>
  headerSearchHandlers({
    films: [sampleFilm],
    people: [samplePerson],
    companies: [sampleCompany],
    collections: [sampleCollection],
  });

function renderSearchBox() {
  return render(
    <MemoryRouter>
      <SearchBox />
    </MemoryRouter>,
  );
}

/** A stub whose "/" renders the box inside a persistent layout, with a landing page per
 *  entity type so a click or Enter can be asserted by where it ends up. */
function renderWithPages() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <>
          <SearchBox />
          <Outlet />
        </>
      ),
      children: [
        { index: true, Component: () => <div>home-page</div> },
        { path: "film/:ref", Component: () => <div>film-page</div> },
        { path: "person/:ref", Component: () => <div>person-page</div> },
        { path: "studio/:ref", Component: () => <div>studio-page</div> },
        { path: "franchise/:ref", Component: () => <div>franchise-page</div> },
      ],
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("SearchBox", () => {
  it("renders a role=search landmark", () => {
    renderSearchBox();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("input is accessibly labeled", () => {
    renderSearchBox();
    expect(screen.getByRole("combobox", { name: /search/i })).toBeInTheDocument();
  });

  it("has no submit button and no form (search is type-ahead only)", () => {
    const { container } = renderSearchBox();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
  });
});

describe("SearchBox dropdown", () => {
  it("opens on typing two or more characters", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");
  });

  it("renders the four groups in spec order, each named for the reader", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");

    // Each group is named by its own heading (aria-labelledby), and they read in the fixed
    // order the spec sets: there is no cross-type ranking to reorder them.
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(4);
    ["Films", "People", "Studios", "Franchises"].forEach((label, i) =>
      expect(groups[i]).toHaveAccessibleName(label),
    );
  });

  it("renders one option per hit across all four groups", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");

    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: /The Odyssey/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Christopher Nolan/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /A24/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Star Wars Collection/i })).toBeInTheDocument();
  });

  it("does not render a group that found nothing", async () => {
    server.use(...headerSearchHandlers({ people: [samplePerson] }));
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "no");
    await screen.findByRole("listbox");

    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.queryByText("Films")).toBeNull();
    expect(screen.queryByText("Studios")).toBeNull();
    expect(screen.queryByText("Franchises")).toBeNull();
  });

  it("links each hit to its own page", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");

    expect(screen.getByRole("link", { name: /The Odyssey/i })).toHaveAttribute(
      "href",
      "/film/the-odyssey-2026",
    );
    expect(screen.getByRole("link", { name: /Christopher Nolan/i })).toHaveAttribute(
      "href",
      "/person/525-christopher-nolan",
    );
    expect(screen.getByRole("link", { name: /A24/i })).toHaveAttribute("href", "/studio/41-a24");
    expect(screen.getByRole("link", { name: /Star Wars Collection/i })).toHaveAttribute(
      "href",
      "/franchise/10-star-wars-collection",
    );
  });

  it.each([
    ["The Odyssey", "film-page"],
    ["Christopher Nolan", "person-page"],
    ["A24", "studio-page"],
    ["Star Wars Collection", "franchise-page"],
  ])("clicking %s lands on its own page", async (name, page) => {
    server.use(...allFour());
    renderWithPages();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");
    await user.click(screen.getByRole("link", { name: new RegExp(name, "i") }));
    expect(await screen.findByText(page)).toBeInTheDocument();
  });

  it("pressing Enter with no active option navigates to the top result", async () => {
    server.use(...allFour());
    renderWithPages();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("film-page")).toBeInTheDocument();
  });

  it("Enter's top result is the first group that found anything, not always a film", async () => {
    server.use(...headerSearchHandlers({ people: [samplePerson] }));
    renderWithPages();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "no");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("person-page")).toBeInTheDocument();
  });

  it("debounce fires exactly one request per endpoint when typing rapidly", async () => {
    const seen: { path: string; q: string | null; limit: string | null }[] = [];
    const record = (path: string) =>
      http.get(`${BACKEND}${path}`, ({ request }) => {
        const url = new URL(request.url);
        seen.push({ path, q: url.searchParams.get("q"), limit: url.searchParams.get("limit") });
        return HttpResponse.json({ items: [sampleFilm], total: 1, limit: 5, offset: 0 });
      });
    server.use(
      record("/films/search"),
      record("/people/search"),
      record("/companies/search"),
      record("/collections/search"),
    );
    renderSearchBox();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByRole("combobox"), "abc");
    // Wait for a rendered hit, not merely for the listbox: the listbox opens on `loading`, so
    // asserting the count before a result lands would pass on zero requests having fired.
    await screen.findByRole("option", { name: /The Odyssey/i });

    // Three keystrokes, one debounced query, one request each — the full fan-out and no more.
    expect(seen.map((r) => r.path).sort()).toEqual([
      "/collections/search",
      "/companies/search",
      "/films/search",
      "/people/search",
    ]);
    // Every request carries the whole typed query and the per-group cap.
    expect(seen.every((r) => r.q === "abc")).toBe(true);
    expect(seen.every((r) => r.limit === "5")).toBe(true);
  });

  it("ArrowDown sets aria-activedescendant to the first option id", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "search-opt-0");
  });

  it("ArrowDown walks out of one group and into the next", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    // One film, so the second press crosses from Films into People.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "search-opt-1");
    expect(screen.getByRole("option", { name: /Christopher Nolan/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("pressing Enter on an active option in a later group navigates to that entity", async () => {
    server.use(...allFour());
    renderWithPages();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(await screen.findByText("studio-page")).toBeInTheDocument();
  });

  it("Escape closes the dropdown, clears the query, and blurs the input", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("");
    expect(input).not.toHaveFocus();
  });

  it("shows the no-results message when nothing matches anywhere", async () => {
    server.use(...headerSearchHandlers());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "xyzzy");
    await screen.findByRole("listbox");
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it("announces the result count via a persistent aria-live status region", async () => {
    server.use(...allFour());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");
    expect(screen.getByRole("status")).toHaveTextContent(/4 results/i);
  });

  it("announces no results via the status region rather than a selectable option", async () => {
    server.use(...headerSearchHandlers());
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "xyzzy");
    await screen.findByRole("listbox");
    // The no-results copy must not be exposed as a selectable listbox option.
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/no results found/i);
  });

  it("says a group could not be searched rather than implying it found nothing", async () => {
    server.use(
      http.get(`${BACKEND}/people/search`, () => new HttpResponse(null, { status: 500 })),
      ...allFour(),
    );
    renderSearchBox();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");

    // The other three still answer, and People is present-but-broken rather than absent —
    // an omitted group would read as "no person matches", which is a different claim.
    expect(screen.getAllByRole("group")).toHaveLength(4);
    expect(screen.queryByRole("option", { name: /Christopher Nolan/i })).toBeNull();
    expect(screen.getByText(/couldn't search people just now/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /The Odyssey/i })).toBeInTheDocument();
  });

  it("closes the dropdown gracefully when every endpoint 500s but keeps the search box", async () => {
    server.use(...headerSearchHandlers({ status: 500 }));
    renderSearchBox();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByRole("combobox"), "err");
    // Wait for debounce (300ms) + request + processing slack, wrapped in act
    // so React can flush state updates that happen during the timeout
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 600));
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("closes the dropdown after selecting a result while the header persists", async () => {
    server.use(...allFour());
    renderWithPages();
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "od");
    await screen.findByRole("listbox");
    await user.click(screen.getByRole("link", { name: /The Odyssey/i }));
    expect(await screen.findByText("film-page")).toBeInTheDocument();
    // The dropdown must not linger over the destination page; the form persists.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("clears the query and closes the dropdown when focus leaves the search box", async () => {
    server.use(...allFour());
    render(
      <MemoryRouter>
        <SearchBox />
        <button type="button">outside</button>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("");
  });
});
