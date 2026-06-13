import { useAuth } from "@/components/AuthContext";

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Upcoming Movies</h1>
      <p className="mt-2 text-muted-foreground">
        Signed in as {user?.display_name}. Tracking features coming soon.
      </p>
    </main>
  );
}
