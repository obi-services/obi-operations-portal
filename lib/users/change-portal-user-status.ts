import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountStatus,
  AppRole,
} from "@/lib/auth/require-portal-profile";

export type StatusChangeActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
  status: "active";
};

export type StatusChangeAction = "suspend" | "reactivate";

export type StatusChangeResult = {
  targetUserId: string;
  email: string;
  fullName: string;
  role: AppRole;
  oldStatus: AccountStatus;
  newStatus: "active" | "suspended";
};

type TargetProfile = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
};

export class PortalStatusChangeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "not_authorized"
      | "target_not_found"
      | "self_change"
      | "invalid_state"
      | "last_active_admin"
      | "database_error",
  ) {
    super(message);
    this.name = "PortalStatusChangeError";
  }
}

function isStatusChangeAction(value: string): value is StatusChangeAction {
  return value === "suspend" || value === "reactivate";
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
    throw new PortalStatusChangeError(
      `Unable to load the target portal profile: ${error.message}`,
      "database_error",
    );
  }

  if (!data) {
    throw new PortalStatusChangeError(
      "The selected portal user could not be found.",
      "target_not_found",
    );
  }

  return data as TargetProfile;
}

function assertActorCanManageTarget(
  actor: StatusChangeActor,
  target: TargetProfile,
): void {
  if (actor.status !== "active") {
    throw new PortalStatusChangeError(
      "Only active privileged users can manage account status.",
      "not_authorized",
    );
  }

  if (actor.id === target.id) {
    throw new PortalStatusChangeError(
      "You cannot suspend or reactivate your own portal account.",
      "self_change",
    );
  }

  if (actor.role === "supervisor" && target.role !== "agent") {
    throw new PortalStatusChangeError(
      "Supervisors can suspend or reactivate Agent accounts only.",
      "not_authorized",
    );
  }

  if (!(["admin", "supervisor"] as const).includes(actor.role)) {
    throw new PortalStatusChangeError(
      "You are not authorized to manage portal account status.",
      "not_authorized",
    );
  }
}

async function assertNotLastActiveAdmin(
  supabase: SupabaseClient,
  target: TargetProfile,
  action: StatusChangeAction,
): Promise<void> {
  if (
    action !== "suspend" ||
    target.role !== "admin" ||
    target.status !== "active"
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
    throw new PortalStatusChangeError(
      `Unable to verify the active administrator count: ${error.message}`,
      "database_error",
    );
  }

  if ((count ?? 0) <= 1) {
    throw new PortalStatusChangeError(
      "The last active administrator cannot be suspended.",
      "last_active_admin",
    );
  }
}

function resolveNewStatus(
  target: TargetProfile,
  action: StatusChangeAction,
): "active" | "suspended" {
  if (action === "suspend") {
    if (target.status !== "active") {
      throw new PortalStatusChangeError(
        `${target.full_name || target.email} must be Active before the account can be suspended.`,
        "invalid_state",
      );
    }

    return "suspended";
  }

  if (target.status !== "suspended") {
    throw new PortalStatusChangeError(
      `${target.full_name || target.email} must be Suspended before the account can be reactivated.`,
      "invalid_state",
    );
  }

  return "active";
}

async function rollbackStatusChange(options: {
  supabase: SupabaseClient;
  target: TargetProfile;
}): Promise<string | null> {
  const { error } = await options.supabase
    .from("profiles")
    .update({ status: options.target.status })
    .eq("id", options.target.id);

  return error?.message ?? null;
}

export async function changePortalUserStatus(
  supabase: SupabaseClient,
  input: {
    actor: StatusChangeActor;
    targetUserId: string;
    action: string;
  },
): Promise<StatusChangeResult> {
  const targetUserId = input.targetUserId.trim();
  const requestedAction = input.action.trim().toLowerCase();

  if (!targetUserId) {
    throw new PortalStatusChangeError(
      "Select a valid portal user.",
      "invalid_input",
    );
  }

  if (!isStatusChangeAction(requestedAction)) {
    throw new PortalStatusChangeError(
      "Select a valid account status action.",
      "invalid_input",
    );
  }

  const target = await getTargetProfile(supabase, targetUserId);

  assertActorCanManageTarget(input.actor, target);

  const newStatus = resolveNewStatus(target, requestedAction);

  await assertNotLastActiveAdmin(supabase, target, requestedAction);

  const { error: profileUpdateError } = await supabase
    .from("profiles")
    .update({ status: newStatus })
    .eq("id", target.id);

  if (profileUpdateError) {
    throw new PortalStatusChangeError(
      `Unable to change the portal account status: ${profileUpdateError.message}`,
      "database_error",
    );
  }

  const { error: eventError } = await supabase
    .from("user_management_events")
    .insert({
      actor_user_id: input.actor.id,
      target_user_id: target.id,
      invitation_id: null,
      target_email: target.email,
      action: "status_changed",
      details: {
        source: "portal",
        actor_email: input.actor.email,
        actor_role: input.actor.role,
        target_full_name: target.full_name,
        target_role: target.role,
        old_status: target.status,
        new_status: newStatus,
      },
    });

  if (eventError) {
    const rollbackError = await rollbackStatusChange({
      supabase,
      target,
    });

    const rollbackMessage = rollbackError
      ? ` Manual review is required because status rollback failed: ${rollbackError}.`
      : " The account status was restored.";

    throw new PortalStatusChangeError(
      `The account status changed, but its audit event could not be recorded: ${eventError.message}.${rollbackMessage}`,
      "database_error",
    );
  }

  return {
    targetUserId: target.id,
    email: target.email,
    fullName: target.full_name,
    role: target.role,
    oldStatus: target.status,
    newStatus,
  };
}
