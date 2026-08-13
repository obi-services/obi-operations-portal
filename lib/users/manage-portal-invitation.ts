import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppRole } from "@/lib/auth/require-portal-profile";

export type InvitationManagementActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
  status: "active";
};

type InvitationStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "revoked"
  | "failed";

type InvitationRecord = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: InvitationStatus;
  invited_user_id: string | null;
  invited_by: string | null;
  sent_at: string;
  last_sent_at: string;
  send_count: number;
  revoked_at: string | null;
  failure_message: string | null;
  metadata: Record<string, unknown> | null;
};

export type InvitationManagementResult = {
  invitationId: string;
  email: string;
  fullName: string;
  action: "resend" | "revoke";
  sendCount: number;
};

export class PortalInvitationManagementError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "not_authorized"
      | "invitation_not_found"
      | "invalid_state"
      | "auth_error"
      | "database_error",
  ) {
    super(message);
    this.name = "PortalInvitationManagementError";
  }
}

async function getInvitation(
  supabase: SupabaseClient,
  invitationId: string,
): Promise<InvitationRecord> {
  const { data, error } = await supabase
    .from("user_invitations")
    .select(
      "id, email, full_name, role, status, invited_user_id, invited_by, sent_at, last_sent_at, send_count, revoked_at, failure_message, metadata",
    )
    .eq("id", invitationId)
    .maybeSingle();

  if (error) {
    throw new PortalInvitationManagementError(
      `Unable to load the invitation: ${error.message}`,
      "database_error",
    );
  }

  if (!data) {
    throw new PortalInvitationManagementError(
      "The selected invitation could not be found.",
      "invitation_not_found",
    );
  }

  return data as InvitationRecord;
}

function assertActorCanManage(
  actor: InvitationManagementActor,
  invitation: InvitationRecord,
): void {
  if (actor.status !== "active") {
    throw new PortalInvitationManagementError(
      "Only active privileged users can manage invitations.",
      "not_authorized",
    );
  }

  if (actor.role === "supervisor" && invitation.role !== "agent") {
    throw new PortalInvitationManagementError(
      "Supervisors can manage Agent invitations only.",
      "not_authorized",
    );
  }
}

function assertPendingInvitation(invitation: InvitationRecord): void {
  if (invitation.status !== "pending") {
    throw new PortalInvitationManagementError(
      `Only pending invitations can be managed. This invitation is ${invitation.status}.`,
      "invalid_state",
    );
  }
}

async function assertAuthUserStillPending(
  supabase: SupabaseClient,
  invitation: InvitationRecord,
): Promise<void> {
  if (!invitation.invited_user_id) {
    return;
  }

  const { data, error } = await supabase.auth.admin.getUserById(
    invitation.invited_user_id,
  );

  if (error) {
    throw new PortalInvitationManagementError(
      `Unable to verify the invited Auth user: ${error.message}`,
      "auth_error",
    );
  }

  if (data.user?.email_confirmed_at) {
    throw new PortalInvitationManagementError(
      "This invitation has already been accepted in Supabase Auth. Refresh the page before trying another action.",
      "invalid_state",
    );
  }
}

async function deletePendingAuthUser(
  supabase: SupabaseClient,
  invitation: InvitationRecord,
): Promise<void> {
  if (!invitation.invited_user_id) {
    return;
  }

  await assertAuthUserStillPending(supabase, invitation);

  const { error } = await supabase.auth.admin.deleteUser(
    invitation.invited_user_id,
  );

  if (error) {
    throw new PortalInvitationManagementError(
      `Unable to invalidate the existing invitation link: ${error.message}`,
      "auth_error",
    );
  }
}

async function recordInvitationFailure(options: {
  supabase: SupabaseClient;
  actor: InvitationManagementActor;
  invitation: InvitationRecord;
  message: string;
  stage: string;
}): Promise<void> {
  const failureMessage = options.message.slice(0, 4000);
  const metadata = {
    ...(options.invitation.metadata ?? {}),
    source: "portal",
    stage: options.stage,
    actor_email: options.actor.email,
    actor_role: options.actor.role,
  };

  const { error: invitationError } = await options.supabase
    .from("user_invitations")
    .update({
      invited_user_id: null,
      failure_message: failureMessage,
      metadata,
    })
    .eq("id", options.invitation.id)
    .eq("status", "pending");

  if (invitationError) {
    console.error(
      `Unable to save the invitation management failure: ${invitationError.message}`,
    );
  }

  const { error: eventError } = await options.supabase
    .from("user_management_events")
    .insert({
      actor_user_id: options.actor.id,
      target_user_id: null,
      invitation_id: options.invitation.id,
      target_email: options.invitation.email,
      action: "invitation_failed",
      details: {
        source: "portal",
        stage: options.stage,
        actor_email: options.actor.email,
        actor_role: options.actor.role,
        target_full_name: options.invitation.full_name,
        target_role: options.invitation.role,
        previous_auth_user_id: options.invitation.invited_user_id,
        message: failureMessage,
      },
    });

  if (eventError) {
    console.error(
      `Unable to create the invitation management failure event: ${eventError.message}`,
    );
  }
}

async function resendInvitation(options: {
  supabase: SupabaseClient;
  actor: InvitationManagementActor;
  invitation: InvitationRecord;
  redirectTo: string;
}): Promise<InvitationManagementResult> {
  await deletePendingAuthUser(options.supabase, options.invitation);

  const { data, error } = await options.supabase.auth.admin.inviteUserByEmail(
    options.invitation.email,
    {
      redirectTo: options.redirectTo,
      data: {
        full_name: options.invitation.full_name,
        role: options.invitation.role,
        invited_by: options.invitation.invited_by ?? options.actor.id,
      },
    },
  );

  if (error || !data.user?.id) {
    const message = error?.message ?? "Supabase did not return the invited user ID.";

    await recordInvitationFailure({
      supabase: options.supabase,
      actor: options.actor,
      invitation: options.invitation,
      message: `Unable to resend invitation: ${message}`,
      stage: "resend_auth_invite",
    });

    throw new PortalInvitationManagementError(
      `Unable to resend invitation: ${message}`,
      "auth_error",
    );
  }

  const newUserId = data.user.id;
  const now = new Date().toISOString();
  const nextSendCount = options.invitation.send_count + 1;
  const metadata = {
    ...(options.invitation.metadata ?? {}),
    source: "portal",
    stage: "resent",
    redirect_to: options.redirectTo,
    invited_by_email: options.actor.email,
    resent_by_email: options.actor.email,
    previous_auth_user_id: options.invitation.invited_user_id,
  };

  const { error: invitationUpdateError } = await options.supabase
    .from("user_invitations")
    .update({
      invited_user_id: newUserId,
      last_sent_at: now,
      send_count: nextSendCount,
      failure_message: null,
      revoked_at: null,
      metadata,
    })
    .eq("id", options.invitation.id)
    .eq("status", "pending");

  if (invitationUpdateError) {
    throw new PortalInvitationManagementError(
      `The invitation email was resent, but its tracking record could not be updated: ${invitationUpdateError.message}`,
      "database_error",
    );
  }

  const { error: profileError } = await options.supabase
    .from("profiles")
    .update({
      full_name: options.invitation.full_name,
      role: options.invitation.role,
      status: "invited",
      invited_by: options.invitation.invited_by ?? options.actor.id,
    })
    .eq("id", newUserId);

  if (profileError) {
    throw new PortalInvitationManagementError(
      `The invitation email was resent, but the portal profile could not be synchronized: ${profileError.message}`,
      "database_error",
    );
  }

  const { error: eventError } = await options.supabase
    .from("user_management_events")
    .insert({
      actor_user_id: options.actor.id,
      target_user_id: newUserId,
      invitation_id: options.invitation.id,
      target_email: options.invitation.email,
      action: "invitation_resent",
      details: {
        source: "portal",
        actor_email: options.actor.email,
        actor_role: options.actor.role,
        target_full_name: options.invitation.full_name,
        target_role: options.invitation.role,
        previous_auth_user_id: options.invitation.invited_user_id,
        new_auth_user_id: newUserId,
        previous_send_count: options.invitation.send_count,
        new_send_count: nextSendCount,
        resent_at: now,
      },
    });

  if (eventError) {
    throw new PortalInvitationManagementError(
      `The invitation email was resent, but its audit event could not be recorded: ${eventError.message}`,
      "database_error",
    );
  }

  return {
    invitationId: options.invitation.id,
    email: options.invitation.email,
    fullName: options.invitation.full_name,
    action: "resend",
    sendCount: nextSendCount,
  };
}

async function revokeInvitation(options: {
  supabase: SupabaseClient;
  actor: InvitationManagementActor;
  invitation: InvitationRecord;
}): Promise<InvitationManagementResult> {
  await deletePendingAuthUser(options.supabase, options.invitation);

  const now = new Date().toISOString();
  const metadata = {
    ...(options.invitation.metadata ?? {}),
    source: "portal",
    stage: "revoked",
    revoked_by_email: options.actor.email,
    previous_auth_user_id: options.invitation.invited_user_id,
  };

  const { data, error: invitationUpdateError } = await options.supabase
    .from("user_invitations")
    .update({
      status: "revoked",
      invited_user_id: null,
      revoked_at: now,
      failure_message: null,
      metadata,
    })
    .eq("id", options.invitation.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (invitationUpdateError) {
    throw new PortalInvitationManagementError(
      `The Auth invitation was invalidated, but its tracking record could not be revoked: ${invitationUpdateError.message}`,
      "database_error",
    );
  }

  if (!data) {
    throw new PortalInvitationManagementError(
      "The invitation is no longer pending. Refresh the page before trying another action.",
      "invalid_state",
    );
  }

  const { error: eventError } = await options.supabase
    .from("user_management_events")
    .insert({
      actor_user_id: options.actor.id,
      target_user_id: null,
      invitation_id: options.invitation.id,
      target_email: options.invitation.email,
      action: "invitation_revoked",
      details: {
        source: "portal",
        actor_email: options.actor.email,
        actor_role: options.actor.role,
        target_full_name: options.invitation.full_name,
        target_role: options.invitation.role,
        previous_auth_user_id: options.invitation.invited_user_id,
        revoked_at: now,
      },
    });

  if (eventError) {
    throw new PortalInvitationManagementError(
      `The invitation was revoked, but its audit event could not be recorded: ${eventError.message}`,
      "database_error",
    );
  }

  return {
    invitationId: options.invitation.id,
    email: options.invitation.email,
    fullName: options.invitation.full_name,
    action: "revoke",
    sendCount: options.invitation.send_count,
  };
}

export async function managePortalInvitation(
  supabase: SupabaseClient,
  input: {
    actor: InvitationManagementActor;
    invitationId: string;
    action: string;
    redirectTo: string;
  },
): Promise<InvitationManagementResult> {
  const invitationId = input.invitationId.trim();
  const action = input.action.trim().toLowerCase();

  if (!invitationId || !["resend", "revoke"].includes(action)) {
    throw new PortalInvitationManagementError(
      "Select a valid invitation action.",
      "invalid_input",
    );
  }

  if (
    input.actor.status !== "active" ||
    !["admin", "supervisor"].includes(input.actor.role)
  ) {
    throw new PortalInvitationManagementError(
      "You are not authorized to manage portal invitations.",
      "not_authorized",
    );
  }

  const invitation = await getInvitation(supabase, invitationId);

  assertActorCanManage(input.actor, invitation);
  assertPendingInvitation(invitation);

  if (action === "resend") {
    return resendInvitation({
      supabase,
      actor: input.actor,
      invitation,
      redirectTo: input.redirectTo,
    });
  }

  return revokeInvitation({
    supabase,
    actor: input.actor,
    invitation,
  });
}
