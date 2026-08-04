import Link from "next/link";
import { Suspense } from "react";

import { requirePortalProfile } from "@/lib/auth/require-portal-profile";
import {
  getModuleDescription,
  getModuleTitle,
  getPortalModulesForRole,
} from "@/lib/portal/modules";

function formatRole(role: string): string {
  return role
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

function DashboardLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-neutral-700 border-t-[#fd961b]" />

        <p className="mt-4 text-sm text-neutral-400">
          Loading your OBI Operations Portal...
        </p>
      </div>
    </main>
  );
}

async function DashboardContent() {
  const profile = await requirePortalProfile();

  const visibleModules =
    getPortalModulesForRole(profile.role);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800 bg-black">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#fd961b]">
              OBI Services
            </p>

            <h1 className="mt-1 text-xl font-bold">
              OBI Operations Portal
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">
                {profile.full_name}
              </p>

              <p className="text-xs text-neutral-400">
                {formatRole(profile.role)}
              </p>
            </div>

            <form
              action="/auth/signout"
              method="post"
            >
              <button
                type="submit"
                className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-semibold transition hover:border-[#fd961b] hover:text-[#fd961b]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-10">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <p className="text-sm font-semibold text-[#31e92b]">
            Account active
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            Welcome, {profile.full_name}
          </h2>

          <div className="mt-5 grid gap-3 text-sm text-neutral-300 sm:grid-cols-3">
            <div>
              <p className="text-neutral-500">
                Email
              </p>

              <p className="mt-1 font-medium">
                {profile.email}
              </p>
            </div>

            <div>
              <p className="text-neutral-500">
                Role
              </p>

              <p className="mt-1 font-medium">
                {formatRole(profile.role)}
              </p>
            </div>

            <div>
              <p className="text-neutral-500">
                Account status
              </p>

              <p className="mt-1 font-medium capitalize">
                {profile.status}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#fd961b]">
            Portal modules
          </p>

          <h2 className="mt-2 text-2xl font-bold">
            Operations dashboard
          </h2>

          <p className="mt-2 text-sm text-neutral-400">
            Select a module to continue.
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {visibleModules.map((module) => (
              <Link
                key={module.key}
                href={module.href}
                className="group rounded-xl border border-neutral-800 bg-neutral-900 p-5 transition hover:-translate-y-0.5 hover:border-[#fd961b]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold group-hover:text-[#fd961b]">
                    {getModuleTitle(
                      module,
                      profile.role,
                    )}
                  </h3>

                  <span className="rounded-full bg-neutral-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Open
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-neutral-400">
                  {getModuleDescription(
                    module,
                    profile.role,
                  )}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}