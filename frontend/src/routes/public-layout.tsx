import { Outlet } from "react-router";
import { GlobalHeader } from "@/components/layout/GlobalHeader";
import { GlobalFooter } from "@/components/layout/GlobalFooter";
import { SearchBox } from "@/components/search/SearchBox";

/**
 * Public shell: GlobalHeader (sticky wordmark + nav/account menu), a search bar below
 * the header, the routed page, then GlobalFooter. Search is type-ahead only — picking a
 * result navigates straight to that film page (there is no search results page).
 */
export default function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <GlobalHeader />
      <div className="border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <SearchBox />
        </div>
      </div>
      <main className="flex-1">
        <Outlet />
      </main>
      <GlobalFooter />
    </div>
  );
}
