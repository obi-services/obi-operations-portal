import Link from "next/link";
import { Suspense } from "react";
import { requirePortalProfile } from "@/lib/auth/require-portal-profile";
import { createClient } from "@/lib/supabase/server";

type ClientRow = { id: string; client_code: string; client_name: string; status: string };
type ProjectRow = {
  id: string;
  client_id: string;
  external_project_id: string;
  project_name: string;
  status: string;
};

async function CreditsOverviewContent() {
  const profile = await requirePortalProfile();
  if (profile.role === "agent") {
    return (
      <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-5xl rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h1 className="text-2xl font-bold">Credits Overview</h1>
          <p className="mt-3 text-neutral-300">Financial access is not enabled for Agent accounts.</p>
          <Link href="/dashboard" className="mt-5 inline-flex rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800">Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: clientRows, error: clientsError }, { data: projectRows, error: projectsError }] = await Promise.all([
    supabase.from("clients").select("id, client_code, client_name, status").order("client_name"),
    supabase.from("projects").select("id, client_id, external_project_id, project_name, status").order("project_name"),
  ]);
  const clients = (clientRows ?? []) as ClientRow[];
  const projects = (projectRows ?? []) as ProjectRow[];
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const loadError = Boolean(clientsError || projectsError);

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-neutral-400">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link><span aria-hidden="true">/</span><span className="text-white">Credits Overview</span>
        </nav>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#fd961b]">Operations</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Credits Overview</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Choose a project to view its credit workspace. Project and client records below are live portal records; financial balances are not connected yet.</p>
          </div>
          <Link href="/dashboard/clients" className="inline-flex w-fit items-center rounded-lg border border-neutral-700 px-4 py-2.5 text-sm font-semibold hover:bg-neutral-800">Client Management</Link>
        </header>

        <section aria-label="Credit monitoring status" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Allocated minutes", "Backend pending"],
            ["Consumed minutes", "Backend pending"],
            ["Remaining minutes", "Backend pending"],
            ["Expiring / low balance", "Backend pending"],
          ].map(([label, value]) => (
            <article key={label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-neutral-400">{label}</p><p className="mt-3 text-lg font-semibold text-neutral-200">{value}</p>
            </article>
          ))}
        </section>

        {loadError ? (
          <section role="alert" className="mt-6 rounded-xl border border-red-900 bg-red-950/30 p-5">
            <h2 className="font-semibold text-red-200">Could not load project records</h2>
            <p className="mt-2 text-sm text-red-100/80">The request failed or your account cannot access these records. Refresh and try again; if the problem continues, contact an administrator.</p>
          </section>
        ) : (
          <section className="mt-7 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <div className="flex flex-col gap-2 border-b border-neutral-800 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="text-lg font-semibold">Projects</h2><p className="mt-1 text-sm text-neutral-400">{projects.length} project record{projects.length === 1 ? "" : "s"} available to your account</p></div>
              <span className="w-fit rounded-full border border-amber-900 bg-amber-950/40 px-3 py-1 text-xs font-semibold text-amber-300">Financial data: Backend pending</span>
            </div>
            {projects.length === 0 ? (
              <div className="p-8 text-center"><h3 className="font-semibold">No accessible projects</h3><p className="mt-2 text-sm text-neutral-400">Projects will appear here when they exist and your role is authorized to view them.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-neutral-950/70 text-xs uppercase tracking-wide text-neutral-400"><tr><th scope="col" className="px-5 py-3">Client</th><th scope="col" className="px-5 py-3">Project</th><th scope="col" className="px-5 py-3">External Project ID</th><th scope="col" className="px-5 py-3">Status</th><th scope="col" className="px-5 py-3">Credit data</th><th scope="col" className="px-5 py-3">Action</th></tr></thead>
                  <tbody className="divide-y divide-neutral-800">
                    {projects.map((project) => {
                      const client = clientById.get(project.client_id);
                      return <tr key={project.id} className="hover:bg-neutral-800/40">
                        <td className="px-5 py-4"><p className="font-medium">{client?.client_name ?? "Client unavailable"}</p><p className="mt-1 text-xs text-neutral-500">{client?.client_code ?? "—"}</p></td>
                        <td className="px-5 py-4 font-medium">{project.project_name}</td>
                        <td className="px-5 py-4 font-mono text-xs text-neutral-300">{project.external_project_id}</td>
                        <td className="px-5 py-4"><span className={project.status === "active" ? "rounded-full bg-emerald-950 px-2.5 py-1 text-xs font-medium text-emerald-300" : "rounded-full bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300"}>{project.status}</span></td>
                        <td className="px-5 py-4 text-neutral-400">Backend pending</td>
                        <td className="px-5 py-4"><Link href={`/dashboard/credits/${project.id}`} className="inline-flex rounded-lg bg-[#fd961b] px-3 py-2 text-xs font-bold text-neutral-950 hover:bg-orange-400">View Credits</Link></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        <p className="mt-5 text-xs leading-5 text-neutral-500">Balances, expiry warnings, transaction history, and Activity Mirror health will appear after the approved backend is implemented. No financial figures are estimated or generated by this page.</p>
      </div>
    </main>
  );
}


function CreditsOverviewLoading() {
  return <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white"><p className="text-sm text-neutral-400">Loading credits overview…</p></main>;
}

export default function CreditsOverviewPage() {
  return <Suspense fallback={<CreditsOverviewLoading />}><CreditsOverviewContent /></Suspense>;
}
