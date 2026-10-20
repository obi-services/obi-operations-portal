import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requirePortalProfile } from "@/lib/auth/require-portal-profile";
import { createClient } from "@/lib/supabase/server";

type ProjectRow = {
  id: string;
  client_id: string;
  external_project_id: string;
  project_name: string;
  status: string;
  notes: string | null;
};
type ClientRow = { id: string; client_code: string; client_name: string; status: string };

async function ProjectCreditsContent({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const profile = await requirePortalProfile();
  if (profile.role === "agent") redirect("/dashboard");
  const { projectId } = await params;
  const { section } = await searchParams;
  const supabase = await createClient();
  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select("id, client_id, external_project_id, project_name, status, notes")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    return (
      <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white sm:px-6">
        <div role="alert" className="mx-auto max-w-4xl rounded-xl border border-red-900 bg-red-950/30 p-6">
          <h1 className="text-xl font-bold">Unable to load project</h1>
          <p className="mt-2 text-sm text-neutral-300">The project could not be retrieved. Please retry or contact an administrator.</p>
          <Link href="/dashboard/credits" className="mt-5 inline-flex rounded-lg border border-neutral-700 px-4 py-2">Back to Credits</Link>
        </div>
      </main>
    );
  }
  if (!projectData) notFound();
  const project = projectData as ProjectRow;
  const { data: clientData } = await supabase
    .from("clients")
    .select("id, client_code, client_name, status")
    .eq("id", project.client_id)
    .maybeSingle();
  const client = clientData as ClientRow | null;
  const addonsSelected = section === "addons";

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-neutral-400">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link><span aria-hidden="true">/</span>
          <Link href="/dashboard/credits" className="hover:text-white">Credits Overview</Link><span aria-hidden="true">/</span><span className="text-white">{project.project_name}</span>
        </nav>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#fd961b]">Project credit workspace</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{project.project_name}</h1>
            <p className="mt-2 text-sm text-neutral-400">{client?.client_name ?? "Client unavailable"} {client ? `(${client.client_code})` : ""} · External Project ID: <span className="font-mono text-neutral-300">{project.external_project_id}</span></p>
          </div>
          <span className="w-fit rounded-full border border-amber-900 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-300">Backend pending</span>
        </header>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-neutral-800 pb-3" aria-label="Project financial sections">
          <Link aria-current={!addonsSelected ? "page" : undefined} href={`/dashboard/credits/${project.id}`} className={!addonsSelected ? "rounded-lg bg-[#fd961b] px-4 py-2 text-sm font-semibold text-neutral-950" : "rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"}>Credits Management</Link>
          <Link aria-current={addonsSelected ? "page" : undefined} href={`/dashboard/credits/${project.id}?section=addons`} className={addonsSelected ? "rounded-lg bg-[#fd961b] px-4 py-2 text-sm font-semibold text-neutral-950" : "rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"}>Add-ons</Link>
          <Link href="/dashboard/clients" className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Client Management</Link>
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Allocated minutes", "Backend pending"],
            ["Consumed minutes", "Backend pending"],
            ["Remaining minutes", "Backend pending"],
            ["Credit expiry", "Backend pending"],
          ].map(([label, value]) => <article key={label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><p className="text-sm text-neutral-400">{label}</p><p className="mt-3 text-lg font-semibold">{value}</p></article>)}
        </section>

        {addonsSelected ? (
          <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#fd961b]">Project-specific Add-ons</p>
            <h2 className="mt-2 text-xl font-bold">Add-on credits</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Add-ons will use this project's shared credit account and transaction ledger. No separate Add-ons balance or ledger is created.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled aria-disabled="true" title="Available after the approved credit backend is implemented" className="cursor-not-allowed rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-500">Add Add-on</button>
              <button type="button" disabled aria-disabled="true" title="Available after the approved credit backend is implemented" className="cursor-not-allowed rounded-lg border border-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-500">View Add-on history</button>
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-xl font-bold">Credit account details</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-400">This page is linked to the selected existing project. The account, subscription terms, expiry rules, ledger, and Activity Mirror sync status are not available until backend implementation.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {["Starting allocation and expiry", "Subscription plan and renewal", "Approved rollover and manual adjustments", "Credit transaction history", "Low-credit and negative-balance alerts", "Activity Mirror synchronization status"].map((label) => <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4"><p className="font-medium">{label}</p><p className="mt-2 text-sm text-neutral-500">Backend pending</p></div>)}
            </div>
          </section>
        )}
        <p className="mt-5 text-xs leading-5 text-neutral-500">All financial operations are disabled. No balances are calculated, and this page does not create or change financial records.</p>
      </div>
    </main>
  );
}


function ProjectCreditsLoading() {
  return <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white"><p className="text-sm text-neutral-400">Loading project credit workspace…</p></main>;
}

export default function ProjectCreditsPage(props: { params: Promise<{ projectId: string }>; searchParams: Promise<{ section?: string }> }) {
  return <Suspense fallback={<ProjectCreditsLoading />}><ProjectCreditsContent {...props} /></Suspense>;
}
