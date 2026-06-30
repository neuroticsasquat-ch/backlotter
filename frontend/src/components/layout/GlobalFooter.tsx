import { Link } from "react-router";
import { WORDMARK } from "@/components/layout/nav-items";

/**
 * Site-wide footer. Fully server-rendered — no auth, no providers needed.
 * Shows the wordmark + copyright and the required TMDB attribution.
 */
export function GlobalFooter() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-t border-border py-8 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 px-4 text-center">
        <span className="font-mono">
          © {year} {WORDMARK.toLowerCase()}. A{" "}
          <a
            href="https://neuroticsasquat.ch"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            neuroticsasquat.ch
          </a>{" "}
          release.
        </span>
        <p className="max-w-prose">
          Film metadata and images are provided by{" "}
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            The Movie Database (TMDB)
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <nav aria-label="Legal" className="flex gap-4">
          <Link
            to="/terms"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Terms
          </Link>
          <Link
            to="/privacy"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
