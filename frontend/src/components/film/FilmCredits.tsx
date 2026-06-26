import type { CastMember } from "@/api/types";
import { profileUrl } from "@/lib/poster";

/** Returns the first letter of up to two words in a name, uppercased. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface FilmCreditsProps {
  directors: string[];
  cast: CastMember[];
}

/** Cast & crew section: director line + scrollable cast card list. */
export function FilmCredits({ directors, cast }: FilmCreditsProps) {
  if (directors.length === 0 && cast.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Cast &amp; crew</h2>

      {directors.length > 0 && (
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-medium">Directed by</span> {directors.join(", ")}
        </p>
      )}

      {cast.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-4">
          {cast.map((member, i) => {
            const img = profileUrl(member.profile_path);
            return (
              <li key={`${member.name}-${i}`} className="flex flex-col items-center w-24">
                {img ? (
                  <img
                    src={img}
                    alt={member.name}
                    width={64}
                    height={96}
                    className="rounded-md object-cover"
                  />
                ) : (
                  <div
                    data-testid="cast-avatar-placeholder"
                    className="flex h-24 w-16 items-center justify-center rounded-md bg-gray-200 text-sm font-medium text-gray-600"
                  >
                    {initials(member.name)}
                  </div>
                )}
                <p className="mt-1 text-center text-xs font-medium">{member.name}</p>
                {member.character && (
                  <p className="text-center text-xs text-gray-500">{member.character}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
