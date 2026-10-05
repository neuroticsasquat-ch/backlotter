/** A rendered day's film links, split into its poster strip and its body. A strip link wraps a
 *  poster; a body link is any other link to a film page, less those carrying a `#`, which point
 *  at one of its events rather than introduce it. */
export function dayFilmLinks(day: HTMLElement): { strip: string[]; body: string[] } {
  const links = [...day.querySelectorAll("a")];
  const href = (link: HTMLAnchorElement) => link.getAttribute("href") ?? "";
  return {
    strip: links.filter((link) => link.querySelector("img")).map(href),
    body: links
      .filter((link) => !link.querySelector("img") && /^\/film\/[^#]+$/.test(href(link)))
      .map(href),
  };
}

/** What the strip must show for a day whose body reads `body`: its distinct film links in
 *  document order, less films without a poster, cut at `limit` (NEU-1533 AC1). */
export function stripFromBody(body: string[], posterless: string[], limit: number): string[] {
  return [...new Set(body)].filter((href) => !posterless.includes(href)).slice(0, limit);
}
