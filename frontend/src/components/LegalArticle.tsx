type LegalArticleProps = {
  html: string;
};

/**
 * Presentational wrapper for a rendered legal document (Terms, Privacy).
 * The HTML comes from our own static, PR-reviewed Markdown via renderMarkdown —
 * never untrusted input — so dangerouslySetInnerHTML is safe here.
 */
export function LegalArticle({ html }: LegalArticleProps) {
  return (
    <article
      className="prose prose-invert mx-auto max-w-3xl px-4 py-8"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
