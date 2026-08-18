import Link from "next/link";
import { Suspense } from "react";

import { requirePrivilegedPortalProfile } from "@/lib/auth/require-portal-profile";
import { createClient } from "@/lib/supabase/server";

type ClientsPageProps = {
  searchParams: Promise<{
    message?: string;
    error?: string;
  }>;
};

type ClientStatus = "active" | "inactive" | "cancelled";
type ProjectStatus = "active" | "inactive" | "cancelled";
type AssignmentStatus = "active" | "inactive";

type ClientRow = {
  id: string;
  client_code: string;
  client_name: string;
  status: ClientStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  client_id: string;
  external_project_id: string;
  project_name: string;
  task_id_prefix: string | null;
  status: ProjectStatus;
  include_in_dashboard: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  project_id: string;
  status: AssignmentStatus;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function clientStatusClass(status: ClientStatus): string {
  switch (status) {
    case "active":
      return "border-green-900 bg-green-950/40 text-green-300";
    case "cancelled":
      return "border-red-900 bg-red-950/40 text-red-300";
    default:
      return "border-neutral-700 bg-neutral-800 text-neutral-300";
  }
}

function projectStatusClass(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "border-green-900 bg-green-950/40 text-green-300";
    case "cancelled":
      return "border-red-900 bg-red-950/40 text-red-300";
    default:
      return "border-neutral-700 bg-neutral-800 text-neutral-300";
  }
}

function ClientsLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <p className="text-sm text-neutral-400">Loading client management...</p>
    </main>
  );
}

async function ClientsContent({ searchParams }: ClientsPageProps) {
  const [profile, parameters] = await Promise.all([
    requirePrivilegedPortalProfile(),
    searchParams,
  ]);

  const supabase = await createClient();

  const [clientsResult, projectsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, client_code, client_name, status, notes, created_at, updated_at",
      )
      .order("client_code", { ascending: true }),
    supabase
      .from("projects")
      .select(
        "id, client_id, external_project_id, project_name, task_id_prefix, status, include_in_dashboard, notes, created_at, updated_at",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("project_assignments")
      .select("id, project_id, status")
      .eq("status", "active"),
  ]);

  const clients = (clientsResult.data ?? []) as ClientRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const activeAssignments = (assignmentsResult.data ?? []) as AssignmentRow[];

  const loadError =
    clientsResult.error?.message ??
    projectsResult.error?.message ??
    assignmentsResult.error?.message ??
    "";

  const activeClientCount = clients.filter(
    (client) => client.status === "active",
  ).length;

  const activeProjectCount = projects.filter(
    (project) => project.status === "active",
  ).length;

  const clientById = new Map(
    clients.map((client) => [client.id, client]),
  );

  const projectById = new Map(
    projects.map((project) => [project.id, project]),
  );

  const projectCountByClient = new Map<string, number>();
  const activeProjectCountByClient = new Map<string, number>();
  const activeAssignmentCountByClient = new Map<string, number>();
  const activeAssignmentCountByProject = new Map<string, number>();

  projects.forEach((project) => {
    projectCountByClient.set(
      project.client_id,
      (projectCountByClient.get(project.client_id) ?? 0) + 1,
    );

    if (project.status === "active") {
      activeProjectCountByClient.set(
        project.client_id,
        (activeProjectCountByClient.get(project.client_id) ?? 0) + 1,
      );
    }
  });

  activeAssignments.forEach((assignment) => {
    const project = projectById.get(assignment.project_id);

    activeAssignmentCountByProject.set(
      assignment.project_id,
      (activeAssignmentCountByProject.get(assignment.project_id) ?? 0) + 1,
    );

    if (!project) {
      return;
    }

    activeAssignmentCountByClient.set(
      project.client_id,
      (activeAssignmentCountByClient.get(project.client_id) ?? 0) + 1,
    );
  });

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-[#fd961b] hover:underline"
            >
              ← Back to dashboard
            </Link>

            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-[#31e92b]">
              OBI Operations Portal
            </p>

            <h1 className="mt-2 text-3xl font-bold">Client Management</h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
              Create and maintain client and project records while reviewing
              active Agent assignments.
            </p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm">
            <p className="text-neutral-500">Signed in as</p>
            <p className="mt-1 font-semibold">{profile.full_name}</p>
            <p className="text-xs capitalize text-neutral-400">
              {profile.role}
            </p>
          </div>
        </div>

        {parameters.message && (
          <div className="mt-6 rounded-lg border border-green-900 bg-green-950/40 px-4 py-3 text-sm text-green-300">
            {parameters.message}
          </div>
        )}

        {parameters.error && (
          <div className="mt-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {parameters.error}
          </div>
        )}

        {loadError && (
          <div className="mt-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            Some client-management records could not be loaded: {loadError}
          </div>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Clients", clients.length],
            ["Active clients", activeClientCount],
            ["Active projects", activeProjectCount],
            ["Active assignments", activeAssignments.length],
          ].map(([label, value]) => (
            <article
              key={label}
              className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"
            >
              <p className="text-sm text-neutral-400">{label}</p>
              <p className="mt-2 text-3xl font-bold">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-xl font-bold">Create a client</h2>

          <p className="mt-2 text-sm text-neutral-400">
            Client IDs are permanent once created. Use the legacy format such
            as CL-001 when applicable.
          </p>

          <form
            action="/dashboard/clients/manage"
            method="post"
            className="mt-6 grid gap-4 xl:grid-cols-[170px_1fr_180px_1fr_auto] xl:items-end"
          >
            <input type="hidden" name="action" value="create" />

            <label className="block text-sm font-medium">
              Client ID
              <input
                name="client_code"
                required
                minLength={2}
                maxLength={40}
                placeholder="CL-001"
                autoComplete="off"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 uppercase outline-none focus:border-[#fd961b]"
              />
            </label>

            <label className="block text-sm font-medium">
              Client name
              <input
                name="client_name"
                required
                minLength={2}
                maxLength={160}
                autoComplete="off"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
              />
            </label>

            <label className="block text-sm font-medium">
              Status
              <select
                name="status"
                defaultValue="active"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>

            <label className="block text-sm font-medium">
              Notes
              <input
                name="notes"
                maxLength={2000}
                autoComplete="off"
                placeholder="Optional"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
              />
            </label>

            <button
              type="submit"
              className="rounded-md bg-[#fd961b] px-5 py-3 font-semibold text-black transition hover:bg-orange-400"
            >
              Create client
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div>
            <h2 className="text-xl font-bold">Clients</h2>

            <p className="mt-2 text-sm text-neutral-400">
              Update client name, status, or notes directly from the table.
              Client IDs remain fixed after creation.
            </p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1420px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-3 py-3 font-medium">Client ID</th>
                  <th className="px-3 py-3 font-medium">Client name</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Projects</th>
                  <th className="px-3 py-3 font-medium">Active projects</th>
                  <th className="px-3 py-3 font-medium">Active assignments</th>
                  <th className="px-3 py-3 font-medium">Notes</th>
                  <th className="px-3 py-3 font-medium">Updated</th>
                  <th className="px-3 py-3 font-medium">Action</th>
                </tr>
              </thead>

              <tbody>
                {clients.map((client) => {
                  const formId = `client-update-${client.id}`;

                  return (
                    <tr
                      key={client.id}
                      className="border-b border-neutral-800/70 align-top"
                    >
                      <td className="px-3 py-4 font-medium text-[#fd961b]">
                        {client.client_code}
                      </td>

                      <td className="px-3 py-4">
                        <input
                          form={formId}
                          name="client_name"
                          required
                          minLength={2}
                          maxLength={160}
                          defaultValue={client.client_name}
                          aria-label={`Client name for ${client.client_code}`}
                          className="w-full min-w-[220px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                        />
                      </td>

                      <td className="px-3 py-4">
                        <select
                          form={formId}
                          name="status"
                          defaultValue={client.status}
                          aria-label={`Status for ${client.client_code}`}
                          className="min-w-[130px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="cancelled">Cancelled</option>
                        </select>

                        <div className="mt-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${clientStatusClass(
                              client.status,
                            )}`}
                          >
                            Current: {formatLabel(client.status)}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {projectCountByClient.get(client.id) ?? 0}
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {activeProjectCountByClient.get(client.id) ?? 0}
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {activeAssignmentCountByClient.get(client.id) ?? 0}
                      </td>

                      <td className="px-3 py-4">
                        <textarea
                          form={formId}
                          name="notes"
                          maxLength={2000}
                          defaultValue={client.notes ?? ""}
                          aria-label={`Notes for ${client.client_code}`}
                          rows={2}
                          className="w-full min-w-[260px] resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                        />
                      </td>

                      <td className="px-3 py-4 text-neutral-400">
                        {formatDate(client.updated_at)}
                      </td>

                      <td className="px-3 py-4">
                        <form
                          id={formId}
                          action="/dashboard/clients/manage"
                          method="post"
                        >
                          <input type="hidden" name="action" value="update" />
                          <input
                            type="hidden"
                            name="client_id"
                            value={client.id}
                          />

                          <button
                            type="submit"
                            className="rounded-md border border-neutral-700 px-4 py-2 text-xs font-semibold transition hover:border-[#fd961b] hover:text-[#fd961b]"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}

                {clients.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-8 text-center text-neutral-500"
                    >
                      No client records were found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-xl font-bold">Create a project</h2>

          <p className="mt-2 text-sm text-neutral-400">
            Project IDs are permanent once created. Active projects require an
            active client.
          </p>

          {clients.length === 0 ? (
            <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-4 text-sm text-neutral-400">
              Create a client before adding a project.
            </div>
          ) : (
            <form
              action="/dashboard/clients/projects/manage"
              method="post"
              className="mt-6 grid gap-4 xl:grid-cols-4"
            >
              <input type="hidden" name="action" value="create" />

              <label className="block text-sm font-medium">
                Client
                <select
                  name="client_id"
                  required
                  defaultValue=""
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
                >
                  <option value="" disabled>
                    Select client
                  </option>

                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.client_code} · {client.client_name} ·{" "}
                      {formatLabel(client.status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
                External Project ID
                <input
                  name="external_project_id"
                  required
                  minLength={1}
                  maxLength={160}
                  autoComplete="off"
                  placeholder="Source project ID"
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
                />
              </label>

              <label className="block text-sm font-medium">
                Project name
                <input
                  name="project_name"
                  required
                  minLength={2}
                  maxLength={160}
                  autoComplete="off"
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
                />
              </label>

              <label className="block text-sm font-medium">
                Task ID Prefix
                <input
                  name="task_id_prefix"
                  maxLength={40}
                  autoComplete="off"
                  placeholder="Optional"
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 uppercase outline-none focus:border-[#fd961b]"
                />
              </label>

              <label className="block text-sm font-medium">
                Status
                <select
                  name="status"
                  defaultValue="active"
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              <label className="block text-sm font-medium">
                Notes
                <input
                  name="notes"
                  maxLength={2000}
                  autoComplete="off"
                  placeholder="Optional"
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
                />
              </label>

              <label className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm font-medium xl:self-end">
                <input
                  name="include_in_dashboard"
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 accent-[#fd961b]"
                />
                Include in dashboard
              </label>

              <button
                type="submit"
                className="rounded-md bg-[#fd961b] px-5 py-3 font-semibold text-black transition hover:bg-orange-400 xl:self-end"
              >
                Create project
              </button>
            </form>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div>
            <h2 className="text-xl font-bold">Projects</h2>

            <p className="mt-2 text-sm text-neutral-400">
              Project/client relationships and external Project IDs remain
              fixed after creation. Project details may be updated here.
            </p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1840px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-3 py-3 font-medium">Client</th>
                  <th className="px-3 py-3 font-medium">External Project ID</th>
                  <th className="px-3 py-3 font-medium">Project name</th>
                  <th className="px-3 py-3 font-medium">Task prefix</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Dashboard</th>
                  <th className="px-3 py-3 font-medium">Active assignments</th>
                  <th className="px-3 py-3 font-medium">Notes</th>
                  <th className="px-3 py-3 font-medium">Updated</th>
                  <th className="px-3 py-3 font-medium">Action</th>
                </tr>
              </thead>

              <tbody>
                {projects.map((project) => {
                  const formId = `project-update-${project.id}`;
                  const client = clientById.get(project.client_id);

                  return (
                    <tr
                      key={project.id}
                      className="border-b border-neutral-800/70 align-top"
                    >
                      <td className="px-3 py-4">
                        <p className="font-medium">
                          {client?.client_code ?? "Unknown"}
                        </p>
                        <p className="mt-1 min-w-[180px] text-xs text-neutral-500">
                          {client?.client_name ?? "Client record unavailable"}
                        </p>
                      </td>

                      <td className="px-3 py-4 font-medium text-[#fd961b]">
                        {project.external_project_id}
                      </td>

                      <td className="px-3 py-4">
                        <input
                          form={formId}
                          name="project_name"
                          required
                          minLength={2}
                          maxLength={160}
                          defaultValue={project.project_name}
                          aria-label={`Project name for ${project.external_project_id}`}
                          className="w-full min-w-[220px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                        />
                      </td>

                      <td className="px-3 py-4">
                        <input
                          form={formId}
                          name="task_id_prefix"
                          maxLength={40}
                          defaultValue={project.task_id_prefix ?? ""}
                          aria-label={`Task ID prefix for ${project.external_project_id}`}
                          className="w-full min-w-[110px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 uppercase outline-none focus:border-[#fd961b]"
                        />
                      </td>

                      <td className="px-3 py-4">
                        <select
                          form={formId}
                          name="status"
                          defaultValue={project.status}
                          aria-label={`Status for ${project.external_project_id}`}
                          className="min-w-[130px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="cancelled">Cancelled</option>
                        </select>

                        <div className="mt-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${projectStatusClass(
                              project.status,
                            )}`}
                          >
                            Current: {formatLabel(project.status)}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-4">
                        <label className="flex min-w-[120px] items-center gap-2">
                          <input
                            form={formId}
                            name="include_in_dashboard"
                            type="checkbox"
                            defaultChecked={project.include_in_dashboard}
                            className="h-4 w-4 accent-[#fd961b]"
                          />
                          <span className="text-neutral-300">
                            {project.include_in_dashboard ? "Included" : "Hidden"}
                          </span>
                        </label>
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {activeAssignmentCountByProject.get(project.id) ?? 0}
                      </td>

                      <td className="px-3 py-4">
                        <textarea
                          form={formId}
                          name="notes"
                          maxLength={2000}
                          defaultValue={project.notes ?? ""}
                          aria-label={`Notes for ${project.external_project_id}`}
                          rows={2}
                          className="w-full min-w-[260px] resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                        />
                      </td>

                      <td className="px-3 py-4 text-neutral-400">
                        {formatDate(project.updated_at)}
                      </td>

                      <td className="px-3 py-4">
                        <form
                          id={formId}
                          action="/dashboard/clients/projects/manage"
                          method="post"
                        >
                          <input type="hidden" name="action" value="update" />
                          <input
                            type="hidden"
                            name="project_id"
                            value={project.id}
                          />

                          <button
                            type="submit"
                            className="rounded-md border border-neutral-700 px-4 py-2 text-xs font-semibold transition hover:border-[#fd961b] hover:text-[#fd961b]"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}

                {projects.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-3 py-8 text-center text-neutral-500"
                    >
                      No project records were found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function ClientsPage(props: ClientsPageProps) {
  return (
    <Suspense fallback={<ClientsLoading />}>
      <ClientsContent {...props} />
    </Suspense>
  );
}
