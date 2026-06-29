import { Link } from "react-router";
import { WORDMARK } from "@/components/layout/nav-items";
import { PrimaryNav } from "@/components/layout/PrimaryNav";
import { NavMenu } from "@/components/layout/MobileMenu";
import HeaderAccount from "@/components/layout/HeaderAccount";

/**
 * Site-wide header, sticky so it stays put while scrolling: the wordmark lockup on the
 * left, then navigation on the right. Wide viewports show the nav + account inline;
 * narrow viewports collapse them into the hamburger NavMenu. The search box renders
 * separately, in its own bar below the header (see PublicLayout).
 *
 * SSR-safe: the account island manages its own client behavior; the server render emits
 * a usable (logged-out, closed-menu) shell.
 */
export function GlobalHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-2.5">
        {/* Wordmark lockup — JetBrains Mono "backlotter" (two-tone) over a rule, with a
            spaced "PRODUCTION LOG" tagline beneath. links home. */}
        <Link
          to="/"
          aria-label={`${WORDMARK} — Production Log`}
          className="flex shrink-0 flex-col font-mono leading-none transition-opacity hover:opacity-80"
        >
          <span className="text-2xl font-bold tracking-tight">
            <span className="font-normal text-muted-foreground">backlot</span>
            <span className="text-foreground">ter</span>
          </span>
          <span aria-hidden="true" className="mt-1.5 h-px w-full bg-border" />
          <span className="mt-1.5 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            production log
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {/* Inline nav + account on wide viewports */}
          <PrimaryNav />
          <div className="hidden md:block">
            <HeaderAccount variant="inline" />
          </div>
          {/* Hamburger on narrow viewports (hidden at md+) */}
          <NavMenu />
        </div>
      </div>
    </header>
  );
}
