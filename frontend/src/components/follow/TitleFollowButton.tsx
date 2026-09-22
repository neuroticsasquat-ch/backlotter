import type { FollowTarget } from "@/lib/film-entities";
import { FollowButton } from "./FollowButton";

/**
 * The film page's one control: *will I hear about this film?* (EF-16)
 *
 * **It is an ordinary title follow, read from `["me","follows"]` like every other follow.**
 * That is the whole of what changed here. The control used to key on a watchlist row, because
 * the watchlist was a computed set a film could enter through a director and *stop* had to
 * choose between muting and unfollowing depending on what else reached it (D-45). Nothing
 * reaches a film indirectly any more: an entity follow delivers that entity's attachment
 * stream and nothing else (EF-3), so the film is on the reader's surfaces exactly when they
 * follow the film. Two states, not three — the mute went with the watchlist it belonged to.
 *
 * It is the page's primary action, hence `emphasis`, and that is the only thing separating it
 * from the {@link FollowButton} the entity pages draw. Kept as a named component rather than
 * inlined because the film page is where a reader decides, and a control that important is
 * worth finding by name.
 */
export function TitleFollowButton({ target }: { target: FollowTarget }) {
  return <FollowButton target={target} emphasis="primary" />;
}
