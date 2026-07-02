import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { AdminLayout } from "./AdminLayout";

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { path: "ingest", element: <div>Ingestion page</div> },
          { path: "sources", element: <div>Sources page</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

it("renders both admin tabs with correct hrefs", () => {
  renderAt("/admin/ingest");
  expect(screen.getByRole("link", { name: "Ingestion" })).toHaveAttribute("href", "/admin/ingest");
  expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/admin/sources");
});

it("marks the active tab based on the current route", () => {
  renderAt("/admin/sources");
  expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Ingestion" })).not.toHaveAttribute("aria-current");
});
