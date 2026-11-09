import { Link } from "react-router";
import { useActiveImport } from "@/api/imports";

/**
 * The timeline's one line about an import whose list is waiting on the user (NEU-1452).
 *
 * The timeline is where Done sends them, and an import that stopped at `awaiting_review` has
 * followed nothing (EF-22), so an empty or unchanged feed would otherwise read as the import
 * having done nothing. A `queued` or `running` job says nothing here: there is nothing to do yet,
 * and progress is `/welcome`'s to show.
 *
 * No count of films, on purpose: a list whose every row is greyed out still has to be confirmed,
 * and "0 films to review" would read as nothing to do. Nothing while the read is pending or
 * failed — the page already stands on its own without it.
 *
 * Only mounted for an entitled reader, which is the only one the route answers.
 */
export function PendingImportNotice() {
  const { data: open } = useActiveImport(true);
  if (open?.status !== "awaiting_review") return null;

  return (
    <div role="status" className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-sm text-foreground">
        Your import is waiting for you to review its list. Nothing is followed until you confirm it.{" "}
        <Link to="/welcome" className="font-medium underline underline-offset-4">
          Review the list
        </Link>
      </p>
    </div>
  );
}
