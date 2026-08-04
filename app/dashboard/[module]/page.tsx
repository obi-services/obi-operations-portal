import Link from "next/link";
import { Suspense } from "react";
import {
  notFound,
  redirect,
} from "next/navigation";

import { requirePortalProfile } from "@/lib/auth/require-portal-profile";
import {
  getModuleDescription,
  getModuleTitle,
  portalModules,
} from "@/lib/portal/modules";

type ModulePageProps = {
  params: Promise<{
    module: string;
  }>;
};

function ModuleLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <p className="text-sm text-neutral-400">
        Loading portal module...
      </p>
    </main>
  );
}

async function ModuleContent({
  params,
}: ModulePageProps) {
  const { module: moduleKey } = await params;

  const profile = await requirePortalProfile();

  const portalModule = portalModules.find(
    (item) => item.key === moduleKey,
  );

  if (!portalModule) {
    notFound();
  }

  if (
    !portalModule.roles.includes(profile.role)
  ) {
    redirect("/dashboard");
  }

  const title = getModuleTitle(
    portalModule,
    profile.role,
  );

  const description = getModuleDescription(
    portalModule,
    profile.role,
  );

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-[#fd961b] hover:underline"
        >
          ← Back to dashboard
        </Link>

        <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#31e92b]">
            OBI Operations Portal
          </p>

          <h1 className="mt-3 text-3xl font-bold">
            {title}
          </h1>

          <p className="mt-3 max-w-2xl leading-7 text-neutral-400">
            {description}
          </p>

          <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-950 p-5">
            <p className="font-semibold">
              Module foundation ready
            </p>

            <p className="mt-2 text-sm leading-6 text-neutral-400">
              The database tables, actions, filters,
              and production interface for this module
              will be added in the next development
              phases.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function ModulePage({
  params,
}: ModulePageProps) {
  return (
    <Suspense fallback={<ModuleLoading />}>
      <ModuleContent params={params} />
    </Suspense>
  );
}