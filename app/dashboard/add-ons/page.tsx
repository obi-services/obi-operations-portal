import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePortalProfile } from "@/lib/auth/require-portal-profile";
import { createClient } from "@/lib/supabase/server";

type ProjectRow = { id: string; client_id: string; external_project_id: string; project_name: string; status: string };
type ClientRow = { id: string; client_code: string; client_name: string };

export default async function AddOnsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const profile = await requirePortalProfile();
  if (profile.role === "agent") redirect("/dashboard");
  const { project: selectedProjectId } = await searchParams;
  const supabase = await createClient();
  const [{ data: projectRows, error: projectError }, { data: clientRows, error: clientError }] = await Promise.all([
    supabase.from("projects").select("id, client_id, external_project_id, project_name, status").order("project_name"),
    supabase.from("clients").select("id, client_code, client_name").order("client_name"),
  ]);
  const projects = (projectRows ?? []) as ProjectRow[];
  const clients = (clientRows ?? []) as ClientRow[];
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const loadError = Boolean(projectError || clientError);

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-neutral-400">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link><span aria-hidden="true">/</span><span className="text-white">Add-ons</span>
        </nav>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#fd961b]">Project credit accounts</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Add-ons</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Choose an authorized project to open its Add-ons section. Add-ons will use the same project credit account and transaction ledger as Credits Management.</p>
        </header>

        {loadError ? (
          <section role="alert" className="mt-7 rounded-xl border border-red-900 bg-red-950/30 p-5">
            <h2 className="font-semibold text-red-200">Unable to load project selection</h2>
            <p className="mt-2 text-sm text-red-100/80">Project records could not be loaded. Refresh the page or contact an administrator if the issue continues.</p>
          </section>
        ) : (
          <>
            <section className="mt-7 rounded-xl border border-neutral-800 bg-neutral-900 p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Select a project</h2>
              <p className="mt-1 text-sm text-neutral-400">The project context is required before opening Add-ons.</p>
              <form action="/dashboard/add-ons" method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="project" className="mb-2 block text-sm font-medium text-neutral-200">Project</label>
                  <select id="project" name="project" defaultValue={selectedProjectId ?? ""} required className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-sm text-white outline-none focus:border-[#fd961b]">
                    <option value="" disabled>Select an authorized project</option>
                    {projects.map((project) => {
                      const client = clientById.get(project.client_id);
                      return <option key={project.id} value={project.id}>{client?.client_name ?? "Client unavailable"} — {project.project_name} ({project.external_project_id})</option>;
                    })}
                  </select>
                </div>
                <button type="submit" className="rounded-lg bg-[#fd961b] px-5 py-3 text-sm font-bold text-neutral-950 hover:bg-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300">Open Add-ons</button>
              </form>
              {projects.length === 0 && <p className="mt-3 text-sm text-neutral-400">No projects are currently available to your account.</p>}
            </section>

            {selectedProject && (
              <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#fd961b]">Selected project</p>
                    <h2 className="mt-2 text-xl font-bold">{selectedProject.project_name}</h2>
                    <p className="mt-1 text-sm text-neutral-400">{clientById.get(selectedProject.client_id)?.client_name ?? "Client unavailable"} · External Project ID: <span className="font-mono">{selectedProject.external_project_id}</span></p>
                    <p className="mt-3 text-sm text-neutral-400">Add-on balances and transaction history: <span className="font-semibold text-neutral-200">Backend pending</span></p>
                  </div>
                  <Link href={`/dashboard/credits/${selectedProject.id}?section=addons`} className="inline-flex w-fit rounded-lg bg-[#fd961b] px-4 py-2.5 text-sm font-bold text-neutral-950 hover:bg-orange-400">Open project Add-ons</Link>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" disabled aria-disabled="true" title="Available after the approved credit backend is implemented" className="cursor-not-allowed rounded-lg border border-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-500">Purchase / add credits</button>
                  <button type="button" disabled aria-disabled="true" title="Available after the approved credit backend is implemented" className="cursor-not-allowed rounded-lg border border-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-500">Review Add-on history</button>
                </div>
                <p className="mt-4 text-xs leading-5 text-neutral-500">Financial actions are disabled. Selecting a project does not create an Add-on or alter its credit balance.</p>
              </section>
            )}
          </>
        )}
        <div className="mt-6"><Link href="/dashboard/credits" className="text-sm font-semibold text-orange-300 hover:text-orange-200">← Back to Credits Overview</Link></div>
      </div>
    </main>
  );
}
