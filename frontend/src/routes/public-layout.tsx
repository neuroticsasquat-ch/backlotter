import { Outlet } from "react-router";
import { GlobalHeader } from "@/components/layout/GlobalHeader";
import { GlobalFooter } from "@/components/layout/GlobalFooter";

/** Public shell: GlobalHeader (sticky nav + account island) + routed page + GlobalFooter. */
export default function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <GlobalHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <GlobalFooter />
    </div>
  );
}
