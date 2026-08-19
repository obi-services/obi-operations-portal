import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requirePrivilegedPortalProfile } from "@/lib/auth/require-portal-profile";
import { createClient } from "@/lib/supabase/server";

type ClientDetailPageProps = {
  params: Promise<{
    clientCode: string;
  }>;
};

type ClientStatus = "active" | "inactive" | "cancelled";
type ProjectStatus = "active" | "inactive" | "cancelled";
type AssignmentStatus = "active" | "inactive";
type AccountStatus = "invited" | "active" | "inactive" | "suspended";
type AppRole = "admin" | "supervisor" | "agent";

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
  agent_user_id: string;
  status: AssignmentStatus;
  assigned_at: string;
  unassigned_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
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

function formatOptionalDate(value: string | null): string {
  return value ? formatDate(value) : "—";
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

function assignmentStatusClass(status: AssignmentStatus): string {
  return status === "active"
    ? "border-green-900 bg-green-950/40 text-green-300"
    : "border-neutral-700 bg-neutral-800 text-neutral-300";
}

function ClientDetailLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <p className="text-sm text-neutral-400">Loading client details...</p>
    </main>
  );
}

async function ClientDetailContent({ params }: ClientDetailPageProps) {
  const [profile, routeParameters] = await Promise.all([
    requirePrivilegedPortalProfile(),
    params,
  ]);

  const normalizedClientCode = routeParameters.clientCode.trim().toUpperCase();
  const supabase = await createClient();

  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select(
      "id, client_code, client_name, status, notes, created_at, updated_at",
    )
    .eq("client_code", normalizedClientCode)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Unable to load the client record: ${clientError.message}`);
  }

  if (!clientData) {
    notFound();
  }

  const client = clientData as ClientRow;

  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select(
      "id, client_id, external_project_id, project_name, task_id_prefix, status, include_in_dashboard, notes, created_at, updated_at",
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: true });

  const projects = (projectData ?? []) as ProjectRow[];
  const projectIds = projects.map((project) => project.id);

  let assignments: AssignmentRow[] = [];
  let assignmentErrorMessage = "";

  if (projectIds.length > 0) {
    const { data: assignmentData, error: assignmentError } = await supabase
      .from("project_assignments")
      .select(
        "id, project_id, agent_user_id, status, assigned_at, unassigned_at, notes, created_at, updated_at",
      )
      .in("project_id", projectIds)
      .order("assigned_at", { ascending: false });

    assignments = (assignmentData ?? []) as AssignmentRow[];
    assignmentErrorMessage = assignmentError?.message ?? "";
  }

  const agentIds = [...new Set(assignments.map((assignment) => assignment.agent_user_id))];

  let agentProfiles: ProfileRow[] = [];
  let profileErrorMessage = "";

  if (agentIds.length > 0) {
    const { data: agentProfileData, error: agentProfileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, status")
      .in("id", agentIds);

    agentProfiles = (agentProfileData ?? []) as ProfileRow[];
    profileErrorMessage = agentProfileError?.message ?? "";
  }

  const loadError =
    projectError?.message ?? assignmentErrorMessage ?? profileErrorMessage;

  const projectById = new Map(
    projects.map((project) => [project.id, project]),
  );

  const profileById = new Map(
    agentProfiles.map((agentProfile) => [agentProfile.id, agentProfile]),
  );

  const activeProjects = projects.filter(
    (project) => project.status === "active",
  );

  const includedProjects = projects.filter(
    (project) => project.include_in_dashboard,
  );

  const activeAssignments = assignments.filter(
    (assignment) => assignment.status === "active",
  );

  const activeAssignmentCountByProject = new Map<string, number>();

  activeAssignments.forEach((assignment) => {
    activeAssignmentCountByProject.set(
      assignment.project_id,
      (activeAssignmentCountByProject.get(assignment.project_id) ?? 0) + 1,
    );
  });

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/dashboard/clients"
              className="text-sm font-semibold text-[#fd961b] hover:underline"
            >
              ← Back to Client Management
            </Link>

            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-[#31e92b]">
              OBI Operations Portal
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold">{client.client_name}</h1>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${clientStatusClass(
                  client.status,
                )}`}
              >
                {formatLabel(client.status)}
              </span>
            </div>

            <p className="mt-2 font-medium text-[#fd961b]">
              {client.client_code}
            </p>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Review this client, its projects, and Agent assignment history in
              one place.
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

        {loadError && (
          <div className="mt-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            Some client-detail records could not be loaded: {loadError}
          </div>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Projects", projects.length],
            ["Active projects", activeProjects.length],
            ["Included in dashboard", includedProjects.length],
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

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <article className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-xl font-bold">Client record</h2>

            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  Client ID
                </dt>
                <dd className="mt-1 font-medium text-[#fd961b]">
                  {client.client_code}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  Status
                </dt>
                <dd className="mt-1 font-medium">
                  {formatLabel(client.status)}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  Created
                </dt>
                <dd className="mt-1 text-sm text-neutral-300">
                  {formatDate(client.created_at)}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  Last updated
                </dt>
                <dd className="mt-1 text-sm text-neutral-300">
                  {formatDate(client.updated_at)}
                </dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-neutral-800 pt-5">
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Notes
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-300">
                {client.notes || "No client notes have been added."}
              </p>
            </div>
          </article>

          <aside className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-lg font-bold">Management actions</h2>

            <p className="mt-2 text-sm leading-6 text-neutral-400">
              Client and project changes remain on the main Client Management
              screen so this detail page stays focused on review and context.
            </p>

            <Link
              href="/dashboard/clients"
              className="mt-5 block rounded-md bg-[#fd961b] px-4 py-3 text-center text-sm font-semibold text-black transition hover:bg-orange-400"
            >
              Manage client and projects
            </Link>
          </aside>
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div>
            <h2 className="text-xl font-bold">Projects</h2>
            <p className="mt-2 text-sm text-neutral-400">
              All projects currently attached to {client.client_code}.
            </p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1240px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-3 py-3 font-medium">External Project ID</th>
                  <th className="px-3 py-3 font-medium">Project name</th>
                  <th className="px-3 py-3 font-medium">Task prefix</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Dashboard</th>
                  <th className="px-3 py-3 font-medium">Active assignments</th>
                  <th className="px-3 py-3 font-medium">Notes</th>
                  <th className="px-3 py-3 font-medium">Updated</th>
                </tr>
              </thead>

              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-neutral-800/70 align-top"
                  >
                    <td className="px-3 py-4 font-medium text-[#fd961b]">
                      {project.external_project_id}
                    </td>

                    <td className="px-3 py-4 font-medium">
                      {project.project_name}
                    </td>

                    <td className="px-3 py-4 text-neutral-300">
                      {project.task_id_prefix || "—"}
                    </td>

                    <td className="px-3 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${projectStatusClass(
                          project.status,
                        )}`}
                      >
                        {formatLabel(project.status)}
                      </span>
                    </td>

                    <td className="px-3 py-4 text-neutral-300">
                      {project.include_in_dashboard ? "Included" : "Hidden"}
                    </td>

                    <td className="px-3 py-4 text-neutral-300">
                      {activeAssignmentCountByProject.get(project.id) ?? 0}
                    </td>

                    <td className="max-w-[300px] px-3 py-4 text-neutral-400">
                      {project.notes || "—"}
                    </td>

                    <td className="px-3 py-4 text-neutral-400">
                      {formatDate(project.updated_at)}
                    </td>
                  </tr>
                ))}

                {projects.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-neutral-500"
                    >
                      This client does not have any project records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">Assignment history</h2>
              <p className="mt-2 text-sm text-neutral-400">
                Current and historical Agent assignment periods across this
                client&apos;s projects.
              </p>
            </div>

            <p className="text-xs text-neutral-500">
              {assignments.length} assignment period
              {assignments.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-3 py-3 font-medium">Project</th>
                  <th className="px-3 py-3 font-medium">Agent</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Assigned</th>
                  <th className="px-3 py-3 font-medium">Unassigned</th>
                  <th className="px-3 py-3 font-medium">Notes</th>
                </tr>
              </thead>

              <tbody>
                {assignments.map((assignment) => {
                  const project = projectById.get(assignment.project_id);
                  const agent = profileById.get(assignment.agent_user_id);

                  return (
                    <tr
                      key={assignment.id}
                      className="border-b border-neutral-800/70 align-top"
                    >
                      <td className="px-3 py-4">
                        <p className="font-medium">
                          {project?.project_name ?? "Unknown project"}
                        </p>
                        <p className="mt-1 text-xs text-[#fd961b]">
                          {project?.external_project_id ?? assignment.project_id}
                        </p>
                      </td>

                      <td className="px-3 py-4">
                        <p className="font-medium">
                          {agent?.full_name || "Unknown Agent"}
                        </p>
                        <p className="mt-1 text-xs capitalize text-neutral-500">
                          {agent
                            ? `${formatLabel(agent.role)} · ${formatLabel(
                                agent.status,
                              )}`
                            : "Profile unavailable"}
                        </p>
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {agent?.email ?? "—"}
                      </td>

                      <td className="px-3 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${assignmentStatusClass(
                            assignment.status,
                          )}`}
                        >
                          {formatLabel(assignment.status)}
                        </span>
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {formatDate(assignment.assigned_at)}
                      </td>

                      <td className="px-3 py-4 text-neutral-300">
                        {formatOptionalDate(assignment.unassigned_at)}
                      </td>

                      <td className="max-w-[320px] px-3 py-4 text-neutral-400">
                        {assignment.notes || "—"}
                      </td>
                    </tr>
                  );
                })}

                {assignments.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-neutral-500"
                    >
                      No Agent assignment history exists for this client yet.
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

export default function ClientDetailPage(props: ClientDetailPageProps) {
  return (
    <Suspense fallback={<ClientDetailLoading />}>
      <ClientDetailContent {...props} />
    </Suspense>
  );
}
