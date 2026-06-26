import { Link } from "react-router";
import { NAV_ITEMS, WORDMARK } from "@/components/layout/nav-items";

// Footer shows only navigable (enabled) destinations — driven from the same NAV_ITEMS
// source as the header so the two can never disagree (and disabled items never 404).
const FOOTER_LINKS = NAV_ITEMS.filter((item) => item.enabled);

/**
 * Site-wide footer. Fully server-rendered — no auth, no providers needed.
 * Shows the wordmark, a copyright line, and a small set of static links.
 */
export function GlobalFooter() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-t border-border py-8 text-sm text-muted-foreground">
      <div className="mx-auto max-w-4xl flex flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between">
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <span>
            © {year} {WORDMARK}
          </span>
        </div>

        <nav aria-label="Footer navigation">
          <ul className="flex flex-wrap gap-4">
            {FOOTER_LINKS.map((item) => (
              <li key={item.href}>
                <Link to={item.href} className="hover:text-foreground transition-colors">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
