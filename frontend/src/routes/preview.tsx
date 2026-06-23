/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta alongside the component */
import type { Route } from "./+types/preview";

export async function loader() {
  return { message: "Public SSR is live." };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Upcoming Movies" }];
}

export default function Preview({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">{loaderData.message}</h1>
    </main>
  );
}
