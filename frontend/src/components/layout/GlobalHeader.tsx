import { Link } from "react-router";
import { WORDMARK } from "@/components/layout/nav-items";
import { PrimaryNav } from "@/components/layout/PrimaryNav";
import HeaderAccount from "@/components/layout/HeaderAccount";

/**
 * Site-wide header. Thin composition: wordmark + primary nav + account island.
 *
 * SSR-safe: no client-only guards needed — HeaderAccount manages its own
 * client island (QueryClientProvider + AuthProvider).
 */
export function GlobalHeader() {
  return (
    <header className="border-b border-border bg-background sticky top-0 z-40">
      <div className="mx-auto max-w-4xl flex h-14 items-center gap-4 px-4">
        {/* Wordmark — links to home */}
        <Link to="/" className="font-semibold text-foreground hover:opacity-80 transition-opacity">
          {WORDMARK}
        </Link>

        {/* Primary navigation */}
        <PrimaryNav />

        {/* M4 search box mounts here — insertion slot */}

        {/* Push account area to the right */}
        <div className="ml-auto">
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}
