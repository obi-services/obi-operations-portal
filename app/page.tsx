import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function HomeLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
      <p className="text-sm text-neutral-400">
        Opening OBI Operations Portal...
      </p>
    </main>
  );
}

async function HomeRedirect(): Promise<null> {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    redirect("/dashboard");
  }

  redirect("/auth/login");

  /*
   * This line is unreachable because redirect() stops execution.
   * It gives the component a valid React return type.
   */
  return null;
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeRedirect />
    </Suspense>
  );
}