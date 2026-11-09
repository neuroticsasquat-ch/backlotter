import { HttpResponse, http } from "msw";
import { env } from "@/env";

const base = env.apiBaseUrl;

/** A `GET /admin/digest/preview` handler answering `html` for the HTML part and `text` for the
 *  text part, each in its own media type, the way the backend does. Records every request's
 *  query so a test can assert what the page asked for. */
export function digestPreviewHandler(
  { html, text }: { html: string; text: string },
  requests: URLSearchParams[] = [],
) {
  return http.get(`${base}/admin/digest/preview`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    requests.push(params);
    return params.get("format") === "text" ? HttpResponse.text(text) : HttpResponse.html(html);
  });
}

/** A `POST /admin/digest/test` handler answering `202 {message_id}`. Records each body. */
export function digestTestSendHandler(messageId: string, bodies: unknown[] = []) {
  return http.post(`${base}/admin/digest/test`, async ({ request }) => {
    bodies.push(await request.json());
    return HttpResponse.json({ message_id: messageId }, { status: 202 });
  });
}
