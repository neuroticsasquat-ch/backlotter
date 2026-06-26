import { useAuth } from "@/components/AuthContext";
import { SITE_NAME } from "@/lib/seo";

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{SITE_NAME}</h1>
      <p className="mt-2 text-muted-foreground">
        Signed in as {user?.display_name}. Tracking features coming soon.
      </p>
    </main>
  );
}
