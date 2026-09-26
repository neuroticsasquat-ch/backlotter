import { useEffect, useId, useState } from "react";
import {
  todayUtc,
  useDigestPreview,
  useSendTestDigest,
  type RenderableCadence,
  type DigestFormat,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { useAdminUsers } from "@/api/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** How many matches the picker lists. The admin is looking for one account, so a search
 *  that returns more than this wants a longer query, not a second page. */
const PICKER_LIMIT = 10;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CADENCES: { value: RenderableCadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const FORMATS: { value: DigestFormat; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "text", label: "Text" },
];

/** The account being previewed. `email` is null when the admin pasted an id: `/admin/users`
 *  searches addresses only, so an id is taken as-is and the preview's 404 says if it is wrong. */
type PickedUser = { id: string; email: string | null };

/** Email or id. A pasted UUID is picked outright; anything else searches addresses through the
 *  grant page's `/admin/users` list and offers the matches to click. */
function UserPicker({
  picked,
  onPick,
}: {
  picked: PickedUser | null;
  onPick: (user: PickedUser) => void;
}) {
  const inputId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  // Debounced like the users page, so a search is one request per pause.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const isId = UUID_PATTERN.test(query);
  useEffect(() => {
    if (isId) onPick({ id: query, email: null });
  }, [isId, query, onPick]);

  const { data, isError } = useAdminUsers(
    { q: query, limit: PICKER_LIMIT },
    { enabled: query !== "" && !isId },
  );
  const matches = query !== "" && !isId ? (data?.items ?? []) : [];

  return (
    <div>
      <Label htmlFor={inputId}>Account</Label>
      <Input
        id={inputId}
        type="search"
        placeholder="Email or user id"
        // The backend caps `q` at 320 (an email's max length); a longer one is a 422.
        maxLength={320}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-1 w-96 max-w-full"
        autoComplete="off"
      />
      {isError && <p className="mt-2 text-sm text-red-600">Failed to search accounts.</p>}
      {data && query !== "" && !isId && matches.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No accounts match your search.</p>
      )}
      {matches.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Matching accounts">
          {matches.map((u) => (
            <li key={u.id}>
              <Button
                size="sm"
                variant={picked?.id === u.id ? "default" : "outline"}
                aria-pressed={picked?.id === u.id}
                onClick={() => onPick({ id: u.id, email: u.email })}
              >
                {u.email}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm">
        {picked ? (
          <>
            Previewing <span className="font-medium">{picked.email ?? picked.id}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No account picked.</span>
        )}
      </p>
    </div>
  );
}

function previewErrorMessage(err: Error): string {
  if (err instanceof ApiError && err.status === 404) return "No account with that id.";
  return `Failed to load the preview: ${err.message}.`;
}

function Preview({
  userId,
  cadence,
  format,
  today,
}: {
  userId: string | null;
  cadence: RenderableCadence;
  format: DigestFormat;
  today: string;
}) {
  const { data, isLoading, isError, error } = useDigestPreview(userId, cadence, format, today);

  if (userId === null) {
    return <p className="text-muted-foreground">Pick an account to preview their digest.</p>;
  }
  if (today === "") return <p className="text-muted-foreground">Pick a date.</p>;
  if (isLoading) return <p className="text-muted-foreground">Rendering the digest…</p>;
  if (isError) return <p className="text-red-600">{previewErrorMessage(error)}</p>;
  if (data === undefined) return null;

  // "Nothing to send." arrives in the requested media type, so it goes in the same frame as a
  // real mail rather than down a branch of its own.
  return format === "html" ? (
    <iframe
      title="Digest preview"
      srcDoc={data}
      // No scripts, no same-origin access: the frame holds a mail, and a mail's markup carries
      // user-supplied titles that must not run with the admin's session.
      sandbox=""
      className="h-[70vh] w-full rounded border bg-white"
    />
  ) : (
    <pre
      aria-label="Digest preview"
      className="overflow-x-auto whitespace-pre-wrap rounded border p-4 text-sm"
    >
      {data}
    </pre>
  );
}

export function AdminDigest() {
  const cadenceName = useId();
  const dateId = useId();
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [cadence, setCadence] = useState<RenderableCadence>("daily");
  const [today, setToday] = useState(() => todayUtc());
  const [format, setFormat] = useState<DigestFormat>("html");
  const send = useSendTestDigest();

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Digest</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Render any account's digest as of any day, or mail it to yourself. Nothing is marked sent,
        and the access gate is ignored.
      </p>

      <div className="mt-6 space-y-4">
        <UserPicker picked={picked} onPick={setPicked} />

        <div className="flex flex-wrap items-end gap-6">
          <fieldset>
            <legend className="text-sm font-medium">Cadence</legend>
            <div className="mt-1 flex gap-4">
              {CADENCES.map((c) => (
                <label key={c.value} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={cadenceName}
                    value={c.value}
                    checked={cadence === c.value}
                    onChange={() => setCadence(c.value)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <Label htmlFor={dateId}>Date (UTC)</Label>
            <input
              id={dateId}
              type="date"
              value={today}
              onChange={(e) => setToday(e.target.value)}
              className="mt-1 block rounded border px-2 py-1 text-sm"
            />
          </div>

          <div role="group" aria-label="Format" className="flex gap-1">
            {FORMATS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={format === f.value ? "default" : "outline"}
                aria-pressed={format === f.value}
                onClick={() => setFormat(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <Button
            disabled={picked === null || today === "" || send.isPending}
            onClick={() => picked && send.mutate({ userId: picked.id, cadence, today })}
          >
            Send to me
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <Preview userId={picked?.id ?? null} cadence={cadence} format={format} today={today} />
      </div>
    </div>
  );
}

export default AdminDigest;
