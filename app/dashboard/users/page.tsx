import Link from "next/link";
import { Suspense } from "react";

import {
  type AccountStatus,
  type AppRole,
  requirePrivilegedPortalProfile,
} from "@/lib/auth/require-portal-profile";
import { createClient } from "@/lib/supabase/server";
import { InvitationAction } from "./invitation-action";
import { UserStatusAction } from "./status-action";

type UsersPageProps = {
  searchParams: Promise<{
    message?: string;
    error?: string;
  }>;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
  accepted_at: string | null;
  created_at: string;
};

type InvitationRow = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: "pending" | "accepted" | "expired" | "revoked" | "failed";
  invited_user_id: string | null;
  sent_at: string;
  last_sent_at: string;
  send_count: number;
  accepted_at: string | null;
  revoked_at: string | null;
  failure_message: string | null;
};

type ManagementEventRow = {
  id: string;
  actor_user_id: string | null;
  target_email: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

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

function statusClass(status: string): string {
  switch (status) {
    case "active":
    case "accepted":
      return "border-green-900 bg-green-950/40 text-green-300";
    case "pending":
    case "invited":
      return "border-orange-900 bg-orange-950/40 text-orange-300";
    case "suspended":
    case "failed":
    case "revoked":
      return "border-red-900 bg-red-950/40 text-red-300";
    default:
      return "border-neutral-700 bg-neutral-800 text-neutral-300";
  }
}

function getDetailString(
  details: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = details?.[key];

  return typeof value === "string" && value.trim() ? value : null;
}

function formatEventSummary(event: ManagementEventRow): string | null {
  if (event.action === "role_changed") {
    const oldRole = getDetailString(event.details, "old_role");
    const newRole = getDetailString(event.details, "new_role");

    if (oldRole && newRole) {
      return `${formatLabel(oldRole)} → ${formatLabel(newRole)}`;
    }
  }

  if (event.action === "status_changed") {
    const oldStatus = getDetailString(event.details, "old_status");
    const newStatus = getDetailString(event.details, "new_status");

    if (oldStatus && newStatus) {
      return `${formatLabel(oldStatus)} → ${formatLabel(newStatus)}`;
    }
  }

  if (event.action === "invitation_resent") {
    const newSendCount = event.details?.new_send_count;

    if (typeof newSendCount === "number") {
      return `Invitation resent · Send #${newSendCount}`;
    }

    return "Invitation resent";
  }

  if (event.action === "invitation_revoked") {
    return "Pending invitation revoked";
  }

  return null;
}

function UsersLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <p className="text-sm text-neutral-400">Loading user management...</p>
    </main>
  );
}

async function UsersContent({ searchParams }: UsersPageProps) {
  const [profile, parameters] = await Promise.all([
    requirePrivilegedPortalProfile(),
    searchParams,
  ]);
  const supabase = await createClient();

  const [
    usersResult,
    invitationsResult,
    pendingInvitationsResult,
    eventsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, email, full_name, role, status, accepted_at, created_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("user_invitations")
      .select(
        "id, email, full_name, role, status, invited_user_id, sent_at, last_sent_at, send_count, accepted_at, revoked_at, failure_message",
      )
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("user_invitations")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("status", "pending"),
    supabase
      .from("user_management_events")
      .select(
        "id, actor_user_id, target_email, action, details, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const users = (usersResult.data ?? []) as UserRow[];
  const invitations = (invitationsResult.data ?? []) as InvitationRow[];
  const events = (eventsResult.data ?? []) as ManagementEventRow[];
  const loadError =
    usersResult.error?.message ??
    invitationsResult.error?.message ??
    pendingInvitationsResult.error?.message ??
    eventsResult.error?.message ??
    "";
  const activeCount = users.filter((user) => user.status === "active").length;
  const agentCount = users.filter((user) => user.role === "agent").length;
  const pendingCount = pendingInvitationsResult.count ?? 0;
  const userById = new Map(users.map((user) => [user.id, user]));
  const isAdmin = profile.role === "admin";

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

            <h1 className="mt-2 text-3xl font-bold">User Management</h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
              Invite portal users and review account, invitation, and audit
              activity. Administrators can change portal roles. Supervisors
              are limited to Agent-level management.
            </p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm">
            <p className="text-neutral-500">Signed in as</p>
            <p className="mt-1 font-semibold">{profile.full_name}</p>
            <p className="text-xs capitalize text-neutral-400">{profile.role}</p>
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
            Some user-management records could not be loaded: {loadError}
          </div>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Portal users", users.length],
            ["Active users", activeCount],
            ["Agents", agentCount],
            ["Pending invitations", pendingCount],
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
          <h2 className="text-xl font-bold">Invite a portal user</h2>
          <p className="mt-2 text-sm text-neutral-400">
            {isAdmin
              ? "Administrators can invite Admin, Supervisor, or Agent accounts."
              : "Supervisors can invite Agent accounts only."}
          </p>

          <form
            action="/dashboard/users/invite"
            method="post"
            className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_180px_auto] lg:items-end"
          >
            <label className="block text-sm font-medium">
              Full name
              <input
                name="full_name"
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
              />
            </label>

            <label className="block text-sm font-medium">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
              />
            </label>

            {isAdmin ? (
              <label className="block text-sm font-medium">
                Role
                <select
                  name="role"
                  defaultValue="agent"
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 outline-none focus:border-[#fd961b]"
                >
                  <option value="agent">Agent</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            ) : (
              <label className="block text-sm font-medium">
                Role
                <input type="hidden" name="role" value="agent" />
                <span className="mt-2 block w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-300">
                  Agent
                </span>
              </label>
            )}

            <button
              type="submit"
              className="rounded-md bg-[#fd961b] px-5 py-3 font-semibold text-black transition hover:bg-orange-400"
            >
              Send invitation
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">Portal users</h2>
              <p className="mt-2 text-sm text-neutral-400">
                {isAdmin
                  ? "Manage another user's role and account status. Your own role and status are locked for safety."
                  : "Supervisors can suspend or reactivate Agent accounts. Role changes remain restricted to administrators."}
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-3 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Accepted</th>
                  <th className="px-3 py-3 font-medium">Created</th>
                  <th className="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isCurrentUser = user.id === profile.id;
                  const canManageStatus =
                    !isCurrentUser &&
                    (user.status === "active" || user.status === "suspended") &&
                    (isAdmin ||
                      (profile.role === "supervisor" && user.role === "agent"));

                  return (
                    <tr key={user.id} className="border-b border-neutral-800/70">
                      <td className="px-3 py-4 font-medium">
                        {user.full_name}
                        {isCurrentUser && (
                          <span className="ml-2 rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                            You
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-4 text-neutral-300">{user.email}</td>
                      <td className="px-3 py-4">
                        {isAdmin && !isCurrentUser ? (
                          <form
                            action="/dashboard/users/role"
                            method="post"
                            className="flex min-w-[245px] items-center gap-2"
                          >
                            <input
                              type="hidden"
                              name="target_user_id"
                              value={user.id}
                            />
                            <select
                              name="role"
                              defaultValue={user.role}
                              aria-label={`Role for ${user.full_name || user.email}`}
                              className="min-w-[130px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-[#fd961b]"
                            >
                              <option value="agent">Agent</option>
                              <option value="supervisor">Supervisor</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button
                              type="submit"
                              className="rounded-md border border-neutral-700 px-3 py-2 text-xs font-semibold transition hover:border-[#fd961b] hover:text-[#fd961b]"
                            >
                              Update
                            </button>
                          </form>
                        ) : (
                          <span>{formatLabel(user.role)}</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(user.status)}`}
                        >
                          {formatLabel(user.status)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-neutral-400">
                        {formatDate(user.accepted_at)}
                      </td>
                      <td className="px-3 py-4 text-neutral-400">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="px-3 py-4">
                        {canManageStatus ? (
                          <UserStatusAction
                            targetUserId={user.id}
                            targetName={user.full_name || user.email}
                            action={
                              user.status === "active"
                                ? "suspend"
                                : "reactivate"
                            }
                          />
                        ) : (
                          <span className="text-xs text-neutral-600">
                            {isCurrentUser ? "Locked" : "Unavailable"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                      No portal users were found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-2">
          <article className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-xl font-bold">Invitation history</h2>

            <div className="mt-5 space-y-3">
              {invitations.map((invitation) => {
                const canManageInvitation =
                  invitation.status === "pending" &&
                  (isAdmin ||
                    (profile.role === "supervisor" &&
                      invitation.role === "agent"));

                return (
                  <div
                    key={invitation.id}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{invitation.full_name}</p>
                        <p className="mt-1 text-sm text-neutral-400">
                          {invitation.email} · {formatLabel(invitation.role)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(invitation.status)}`}
                      >
                        {formatLabel(invitation.status)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                      <span>First sent {formatDate(invitation.sent_at)}</span>
                      <span>Last sent {formatDate(invitation.last_sent_at)}</span>
                      <span>Send count {invitation.send_count}</span>
                    </div>

                    {invitation.revoked_at && (
                      <p className="mt-2 text-xs text-neutral-500">
                        Revoked {formatDate(invitation.revoked_at)}
                      </p>
                    )}

                    {invitation.failure_message && (
                      <p className="mt-2 text-xs text-red-300">
                        {invitation.failure_message}
                      </p>
                    )}

                    {canManageInvitation && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <InvitationAction
                          invitationId={invitation.id}
                          email={invitation.email}
                          action="resend"
                        />
                        <InvitationAction
                          invitationId={invitation.id}
                          email={invitation.email}
                          action="revoke"
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {invitations.length === 0 && (
                <p className="text-sm text-neutral-500">
                  No invitation records were found.
                </p>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-xl font-bold">Recent user activity</h2>

            <div className="mt-5 space-y-3">
              {events.map((event) => {
                const eventSummary = formatEventSummary(event);
                const actor = event.actor_user_id
                  ? userById.get(event.actor_user_id)
                  : null;
                const actorEmail = getDetailString(
                  event.details,
                  "actor_email",
                );

                return (
                  <div
                    key={event.id}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                  >
                    <p className="font-semibold">{formatLabel(event.action)}</p>
                    <p className="mt-1 text-sm text-neutral-400">
                      {event.target_email}
                    </p>
                    {eventSummary && (
                      <p className="mt-2 text-sm text-neutral-300">
                        {eventSummary}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-neutral-500">
                      By {actor?.full_name || actor?.email || actorEmail || "System"}
                      {" · "}
                      {formatDate(event.created_at)}
                    </p>
                  </div>
                );
              })}

              {events.length === 0 && (
                <p className="text-sm text-neutral-500">
                  No management activity was found.
                </p>
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

export default function UsersPage(props: UsersPageProps) {
  return (
    <Suspense fallback={<UsersLoading />}>
      <UsersContent {...props} />
    </Suspense>
  );
}
