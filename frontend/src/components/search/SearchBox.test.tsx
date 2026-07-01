import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Outlet, createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { filmsSearchHandler } from "@/test/msw/films-search";
import { SearchBox } from "@/components/search/SearchBox";
import type { FilmIndexItem } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sampleItem: FilmIndexItem = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "wrapped",
};

function renderSearchBox() {
  return render(
    <MemoryRouter>
      <SearchBox />
    </MemoryRouter>,
  );
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
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
  });

  it("renders role=option rows with film titles (no see-all row — no results page)", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    expect(screen.getByRole("option", { name: /The Odyssey/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /see all results/i })).toBeNull();
  });

  it("pressing Enter with no active option navigates to the top result", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    const Stub = createRoutesStub([
      { path: "/", Component: () => <SearchBox /> },
      { path: "/film/:slug", Component: () => <div>film-page</div> },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("film-page")).toBeInTheDocument();
  });

  it("debounce fires at most one request when typing rapidly", async () => {
    let requestCount = 0;
    server.use(
      http.get(`${BACKEND}/films/search`, () => {
        requestCount++;
        return HttpResponse.json({
          items: [sampleItem],
          total: 1,
          limit: 8,
          offset: 0,
        });
      }),
    );
    renderSearchBox();
    const user = userEvent.setup({ delay: null });
    const input = screen.getByRole("combobox");
    await user.type(input, "abc");
    await screen.findByRole("listbox");
    expect(requestCount).toBeLessThanOrEqual(1);
  });

  it("ArrowDown sets aria-activedescendant to the first option id", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "search-opt-0");
  });

  it("Escape closes the dropdown, clears the query, and blurs the input", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
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

  it("pressing Enter on the active option navigates to the film page", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    const Stub = createRoutesStub([
      { path: "/", Component: () => <SearchBox /> },
      { path: "/film/:slug", Component: () => <div>film-page</div> },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("film-page")).toBeInTheDocument();
  });

  it("shows the no-results message when the backend returns an empty list", async () => {
    server.use(filmsSearchHandler({ items: [] }));
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "xyzzy");
    await screen.findByRole("listbox");
    expect(screen.getByText(/no films match/i)).toBeInTheDocument();
  });

  it("announces the result count via a persistent aria-live status region", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    expect(screen.getByRole("status")).toHaveTextContent(/1 result/i);
  });

  it("announces no results via the status region rather than a selectable option", async () => {
    server.use(filmsSearchHandler({ items: [] }));
    renderSearchBox();
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "xyzzy");
    await screen.findByRole("listbox");
    // The no-results copy must not be exposed as a selectable listbox option.
    expect(screen.queryByRole("option")).toBeNull();
    // The empty state is announced through the live region instead.
    expect(screen.getByRole("status")).toHaveTextContent(/no films found/i);
  });

  it("closes the dropdown gracefully on a 500 error but keeps the search box", async () => {
    server.use(filmsSearchHandler({ status: 500 }));
    renderSearchBox();
    const user = userEvent.setup({ delay: null });
    const input = screen.getByRole("combobox");
    await user.type(input, "err");
    // Wait for debounce (300ms) + request + processing slack, wrapped in act
    // so React can flush state updates that happen during the timeout
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 600));
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("closes the dropdown after selecting a result while the header persists", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    // SearchBox lives in a persistent layout that stays mounted across navigation.
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
          { path: "film/:slug", Component: () => <div>film-page</div> },
        ],
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox");
    await user.type(input, "od");
    await screen.findByRole("listbox");
    await user.click(screen.getByRole("link", { name: /The Odyssey/i }));
    expect(await screen.findByText("film-page")).toBeInTheDocument();
    // The dropdown must not linger over the destination page; the form persists.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("clears the query and closes the dropdown when focus leaves the search box", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
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
