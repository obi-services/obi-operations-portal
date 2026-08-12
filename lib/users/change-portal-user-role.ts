import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountStatus,
  AppRole,
} from "@/lib/auth/require-portal-profile";

export type RoleChangeActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
  status: "active";
};

export type RoleChangeResult = {
  targetUserId: string;
  email: string;
  fullName: string;
  oldRole: AppRole;
  newRole: AppRole;
};

type TargetProfile = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
};

type PendingInvitation = {
  id: string;
  role: AppRole;
};

export class PortalRoleChangeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "not_authorized"
      | "target_not_found"
      | "self_change"
      | "no_change"
      | "last_active_admin"
      | "database_error",
  ) {
    super(message);
    this.name = "PortalRoleChangeError";
  }
}

function isAppRole(value: string): value is AppRole {
  return ["admin", "supervisor", "agent"].includes(value);
}

async function getTargetProfile(
  supabase: SupabaseClient,
  targetUserId: string,
): Promise<TargetProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error) {
    throw new PortalRoleChangeError(
      `Unable to load the target portal profile: ${error.message}`,
      "database_error",
    );
  }

  if (!data) {
    throw new PortalRoleChangeError(
      "The selected portal user could not be found.",
      "target_not_found",
    );
  }

  return data as TargetProfile;
}

async function assertNotLastActiveAdmin(
  supabase: SupabaseClient,
  target: TargetProfile,
  newRole: AppRole,
): Promise<void> {
  if (
    target.role !== "admin" ||
    target.status !== "active" ||
    newRole === "admin"
  ) {
    return;
  }

  const { count, error } = await supabase
    .from("profiles")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("role", "admin")
    .eq("status", "active");

  if (error) {
    throw new PortalRoleChangeError(
      `Unable to verify the active administrator count: ${error.message}`,
      "database_error",
    );
  }

  if ((count ?? 0) <= 1) {
    throw new PortalRoleChangeError(
      "The last active administrator cannot be changed to another role.",
      "last_active_admin",
    );
  }
}

async function getPendingInvitation(
  supabase: SupabaseClient,
  target: TargetProfile,
): Promise<PendingInvitation | null> {
  if (target.status !== "invited") {
    return null;
  }

  const byUserId = await supabase
    .from("user_invitations")
    .select("id, role")
    .eq("invited_user_id", target.id)
    .eq("status", "pending")
    .maybeSingle();

  if (byUserId.error) {
    throw new PortalRoleChangeError(
      `Unable to check the pending invitation: ${byUserId.error.message}`,
      "database_error",
    );
  }

  if (byUserId.data) {
    return byUserId.data as PendingInvitation;
  }

  const byEmail = await supabase
    .from("user_invitations")
    .select("id, role")
    .eq("email", target.email)
    .eq("status", "pending")
    .maybeSingle();

  if (byEmail.error) {
    throw new PortalRoleChangeError(
      `Unable to check the pending invitation: ${byEmail.error.message}`,
      "database_error",
    );
  }

  return (byEmail.data as PendingInvitation | null) ?? null;
}

async function rollbackRoleChange(options: {
  supabase: SupabaseClient;
  target: TargetProfile;
  pendingInvitation: PendingInvitation | null;
  restoreInvitation: boolean;
}): Promise<string[]> {
  const rollbackErrors: string[] = [];

  const { error: profileRollbackError } = await options.supabase
    .from("profiles")
    .update({ role: options.target.role })
    .eq("id", options.target.id);

  if (profileRollbackError) {
    rollbackErrors.push(
      `profile rollback failed: ${profileRollbackError.message}`,
    );
  }

  if (options.pendingInvitation && options.restoreInvitation) {
    const { error: invitationRollbackError } = await options.supabase
      .from("user_invitations")
      .update({ role: options.pendingInvitation.role })
      .eq("id", options.pendingInvitation.id);

    if (invitationRollbackError) {
      rollbackErrors.push(
        `invitation rollback failed: ${invitationRollbackError.message}`,
      );
    }
  }

  return rollbackErrors;
}

export async function changePortalUserRole(
  supabase: SupabaseClient,
  input: {
    actor: RoleChangeActor;
    targetUserId: string;
    newRole: string;
  },
): Promise<RoleChangeResult> {
  const targetUserId = input.targetUserId.trim();
  const requestedRole = input.newRole.trim().toLowerCase();

  if (!targetUserId) {
    throw new PortalRoleChangeError(
      "Select a valid portal user.",
      "invalid_input",
    );
  }

  if (!isAppRole(requestedRole)) {
    throw new PortalRoleChangeError(
      "Select a valid portal role.",
      "invalid_input",
    );
  }

  if (input.actor.status !== "active" || input.actor.role !== "admin") {
    throw new PortalRoleChangeError(
      "Only active administrators can change portal roles.",
      "not_authorized",
    );
  }

  if (input.actor.id === targetUserId) {
    throw new PortalRoleChangeError(
      "You cannot change your own portal role.",
      "self_change",
    );
  }

  const target = await getTargetProfile(supabase, targetUserId);

  if (target.role === requestedRole) {
    throw new PortalRoleChangeError(
      `${target.full_name || target.email} already has the ${requestedRole} role.`,
      "no_change",
    );
  }

  await assertNotLastActiveAdmin(supabase, target, requestedRole);

  const pendingInvitation = await getPendingInvitation(supabase, target);

  const { error: profileUpdateError } = await supabase
    .from("profiles")
    .update({ role: requestedRole })
    .eq("id", target.id);

  if (profileUpdateError) {
    throw new PortalRoleChangeError(
      `Unable to change the portal role: ${profileUpdateError.message}`,
      "database_error",
    );
  }

  let invitationUpdated = false;

  if (pendingInvitation) {
    const { error: invitationUpdateError } = await supabase
      .from("user_invitations")
      .update({ role: requestedRole })
      .eq("id", pendingInvitation.id)
      .eq("status", "pending");

    if (invitationUpdateError) {
      const rollbackErrors = await rollbackRoleChange({
        supabase,
        target,
        pendingInvitation,
        restoreInvitation: false,
      });

      const rollbackMessage = rollbackErrors.length
        ? ` Manual review is required because ${rollbackErrors.join("; ")}.`
        : " The profile role was restored.";

      throw new PortalRoleChangeError(
        `The profile role changed, but the pending invitation could not be synchronized: ${invitationUpdateError.message}.${rollbackMessage}`,
        "database_error",
      );
    }

    invitationUpdated = true;
  }

  const { error: eventError } = await supabase
    .from("user_management_events")
    .insert({
      actor_user_id: input.actor.id,
      target_user_id: target.id,
      invitation_id: pendingInvitation?.id ?? null,
      target_email: target.email,
      action: "role_changed",
      details: {
        source: "portal",
        actor_email: input.actor.email,
        actor_role: input.actor.role,
        target_full_name: target.full_name,
        target_status: target.status,
        old_role: target.role,
        new_role: requestedRole,
      },
    });

  if (eventError) {
    const rollbackErrors = await rollbackRoleChange({
      supabase,
      target,
      pendingInvitation,
      restoreInvitation: invitationUpdated,
    });

    const rollbackMessage = rollbackErrors.length
      ? ` Manual review is required because ${rollbackErrors.join("; ")}.`
      : " The role change was rolled back.";

    throw new PortalRoleChangeError(
      `The role changed, but its audit event could not be recorded: ${eventError.message}.${rollbackMessage}`,
      "database_error",
    );
  }

  return {
    targetUserId: target.id,
    email: target.email,
    fullName: target.full_name,
    oldRole: target.role,
    newRole: requestedRole,
  };
}
