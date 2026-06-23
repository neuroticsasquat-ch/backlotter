/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta alongside the component */
import type { Route } from "./+types/preview";
import { buildMeta } from "@/lib/seo";

export async function loader() {
  return { message: "Public SSR is live." };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Preview",
    description: "A server-rendered preview of the public Upcoming Movies Tracker surface.",
    pathname: location.pathname,
  });
}

export default function Preview({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">{loaderData.message}</h1>
    </main>
  );
}
