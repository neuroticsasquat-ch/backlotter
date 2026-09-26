/**
 * Initials for the account avatar.
 *
 * The account has no picture to show — `AuthedUser` carries a `display_name` and an email
 * and nothing else — so the avatar is built from the name. Kept as a pure function with its
 * own tests because the inputs are messier than they look: a display name can be a single
 * word, an email address (that is what it defaults to), an empty string, or a name whose
 * first character is outside the basic plane.
 */

/** The first character of a string **by code point**, not by UTF-16 unit. `"𝐓om".charAt(0)`
 *  returns half a surrogate pair and renders as a replacement glyph; `Array.from` splits on
 *  code points and keeps the character whole. */
function firstCodePoint(value: string): string {
  return Array.from(value)[0] ?? "";
}

/**
 * One or two letters standing in for the user.
 *
 * Two words give first-and-last (`"Mary Jane Watson"` → `MW`, so a middle name does not
 * displace the surname); one word gives one letter. A blank name falls back to the email,
 * which every account has, and only a user with neither gets the `?` placeholder.
 */
export function accountInitials(
  displayName: string | null | undefined,
  email?: string | null,
): string {
  const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    const first = firstCodePoint(words[0]);
    const last = firstCodePoint(words[words.length - 1]);
    return (first + last).toUpperCase();
  }
  if (words.length === 1) {
    return firstCodePoint(words[0]).toUpperCase();
  }

  // No usable name. The local part of the address is the next best thing a human would
  // recognise, and the first letter in it beats the first character — an address that
  // starts with a digit or a dot would otherwise give an avatar reading "." or "7".
  const local = (email ?? "").trim().split("@")[0] ?? "";
  const letter = Array.from(local).find((char) => /\p{L}|\p{N}/u.test(char));
  return letter ? letter.toUpperCase() : "?";
}
