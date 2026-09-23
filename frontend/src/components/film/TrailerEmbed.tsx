import { useState } from "react";
import { Button } from "@/components/ui/button";

/** `youtube-nocookie.com`, not `youtube.com`: the standard embed drops tracking cookies the
 *  moment the frame loads, before the visitor presses play. D-35 calls for the privacy-enhanced
 *  host, and that choice is the only thing separating the two URLs. */
const EMBED_ORIGIN = "https://www.youtube-nocookie.com/embed";

/** Everything the player needs and nothing it doesn't. `autoplay` is deliberately absent —
 *  D-35 asks for no autoplay, and the URL carries no `autoplay=1` either, so a trailer only
 *  ever plays on a second, deliberate click inside the frame. */
const EMBED_ALLOW =
  "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture";

/** A "watch the trailer" toggle that expands a YouTube player in place.
 *
 *  The frame is mounted only once the toggle is pressed, which is what keeps this SSR-safe:
 *  the server render and the first client paint both produce the bare button, so there is no
 *  hydration mismatch to reconcile — and no third-party iframe on a page nobody asked to watch
 *  a trailer on. `title` is the frame's accessible name; `label` is the button's. */
export function TrailerEmbed({
  videoKey,
  label,
  title,
}: {
  videoKey: string;
  label: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant={open ? "secondary" : "outline"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open && (
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg bg-muted">
          <iframe
            className="h-full w-full"
            // The key is TMDB's, passed through untouched by the backend, so it is encoded
            // rather than trusted to be URL-safe.
            src={`${EMBED_ORIGIN}/${encodeURIComponent(videoKey)}`}
            title={title}
            allow={EMBED_ALLOW}
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
