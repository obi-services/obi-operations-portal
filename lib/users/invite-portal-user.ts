import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppRole } from "@/lib/auth/require-portal-profile";

type FailureStage =
  | "auth_invite"
  | "invitation_update"
  | "profile_update"
  | "audit_event";

export type InvitationActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
};

export type InvitePortalUserInput = {
  email: string;
  fullName: string;
  role: AppRole;
  actor: InvitationActor | null;
  redirectTo: string;
  source: "portal" | "cli";
};

export type InvitePortalUserResult = {
  invitationId: string;
  invitedUserId: string;
  email: string;
  role: AppRole;
};

export class PortalInvitationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "profile_exists"
      | "pending_exists"
      | "database_error"
      | "email_error",
  ) {
    super(message);
    this.name = "PortalInvitationError";
  }
}

class InvitationStageError extends Error {
  constructor(
    readonly stage: FailureStage,
    message: string,
  ) {
    super(message);
    this.name = "InvitationStageError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, " ");
}

function validateInput(input: InvitePortalUserInput): {
  email: string;
  fullName: string;
} {
  const email = normalizeEmail(input.email);
  const fullName = normalizeName(input.fullName);

  if (!email || !email.includes("@") || email.length > 320) {
    throw new PortalInvitationError(
      "Enter a valid email address.",
      "invalid_input",
    );
  }

  if (fullName.length < 2 || fullName.length > 120) {
    throw new PortalInvitationError(
      "Full name must contain between 2 and 120 characters.",
      "invalid_input",
    );
  }

  if (!(["admin", "supervisor", "agent"] as AppRole[]).includes(input.role)) {
    throw new PortalInvitationError(
      "Select a valid portal role.",
      "invalid_input",
    );
  }

  return { email, fullName };
}

async function assertTargetDoesNotExist(
  supabase: SupabaseClient,
  email: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new PortalInvitationError(
      `Unable to check the existing portal profile: ${error.message}`,
      "database_error",
    );
  }

  if (data) {
    throw new PortalInvitationError(
      `A portal account already exists for ${email}.`,
      "profile_exists",
    );
  }
}

async function assertNoPendingInvitation(
  supabase: SupabaseClient,
  email: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("user_invitations")
    .select("id")
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new PortalInvitationError(
      `Unable to check pending invitations: ${error.message}`,
      "database_error",
    );
  }

  if (data) {
    throw new PortalInvitationError(
      `A pending invitation already exists for ${email}.`,
      "pending_exists",
    );
  }
}

async function createPendingInvitation(options: {
  supabase: SupabaseClient;
  email: string;
  fullName: string;
  input: InvitePortalUserInput;
}): Promise<string> {
  const { data, error } = await options.supabase
    .from("user_invitations")
    .insert({
      email: options.email,
      full_name: options.fullName,
      role: options.input.role,
      status: "pending",
      invited_by: options.input.actor?.id ?? null,
      metadata: {
        source: options.input.source,
        redirect_to: options.input.redirectTo,
        invited_by_email: options.input.actor?.email ?? null,
        stage: "created",
      },
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new PortalInvitationError(
        `A pending invitation already exists for ${options.email}.`,
        "pending_exists",
      );
    }

    throw new PortalInvitationError(
      `Unable to create the invitation record: ${error.message}`,
      "database_error",
    );
  }

  return data.id as string;
}

async function recordFailure(options: {
  supabase: SupabaseClient;
  input: InvitePortalUserInput;
  email: string;
  invitationId: string;
  invitedUserId: string | null;
  stage: FailureStage;
  message: string;
  markInvitationFailed: boolean;
}): Promise<void> {
  const failureMessage = options.message.slice(0, 4000);

  const { error: invitationError } = await options.supabase
    .from("user_invitations")
    .update({
      status: options.markInvitationFailed ? "failed" : "pending",
      invited_user_id: options.invitedUserId,
      failure_message: failureMessage,
      metadata: {
        source: options.input.source,
        redirect_to: options.input.redirectTo,
        invited_by_email: options.input.actor?.email ?? null,
        stage: options.stage,
      },
    })
    .eq("id", options.invitationId);

  if (invitationError) {
    console.error(
      `Unable to update the failed invitation record: ${invitationError.message}`,
    );
  }

  const { error: eventError } = await options.supabase
    .from("user_management_events")
    .insert({
      actor_user_id: options.input.actor?.id ?? null,
      target_user_id: options.invitedUserId,
      invitation_id: options.invitationId,
      target_email: options.email,
      action: "invitation_failed",
      details: {
        source: options.input.source,
        stage: options.stage,
        role: options.input.role,
        auth_user_id: options.invitedUserId,
        message: failureMessage,
      },
    });

  if (eventError) {
    console.error(
      `Unable to create the invitation failure event: ${eventError.message}`,
    );
  }
}

export async function invitePortalUser(
  supabase: SupabaseClient,
  input: InvitePortalUserInput,
): Promise<InvitePortalUserResult> {
  const { email, fullName } = validateInput(input);

  await assertTargetDoesNotExist(supabase, email);
  await assertNoPendingInvitation(supabase, email);

  const invitationId = await createPendingInvitation({
    supabase,
    email,
    fullName,
    input,
  });

  let invitedUserId: string | null = null;

  try {
    const { data, error } =
      await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: input.redirectTo,
        data: {
          full_name: fullName,
          role: input.role,
          invited_by: input.actor?.id ?? null,
        },
      });

    if (error) {
      throw new InvitationStageError(
        "auth_invite",
        `Unable to send invitation: ${error.message}`,
      );
    }

    invitedUserId = data.user?.id ?? null;

    if (!invitedUserId) {
      throw new InvitationStageError(
        "auth_invite",
        "Supabase did not return the invited user ID.",
      );
    }

    const { error: invitationUpdateError } = await supabase
      .from("user_invitations")
      .update({
        invited_user_id: invitedUserId,
        failure_message: null,
        metadata: {
          source: input.source,
          redirect_to: input.redirectTo,
          invited_by_email: input.actor?.email ?? null,
          stage: "sent",
        },
      })
      .eq("id", invitationId);

    if (invitationUpdateError) {
      throw new InvitationStageError(
        "invitation_update",
        `Invitation was sent, but its database record could not be updated: ${invitationUpdateError.message}`,
      );
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        role: input.role,
        status: "invited",
        invited_by: input.actor?.id ?? null,
      })
      .eq("id", invitedUserId);

    if (profileError) {
      throw new InvitationStageError(
        "profile_update",
        `Invitation was sent, but the portal profile could not be updated: ${profileError.message}`,
      );
    }

    const { error: eventError } = await supabase
      .from("user_management_events")
      .insert({
        actor_user_id: input.actor?.id ?? null,
        target_user_id: invitedUserId,
        invitation_id: invitationId,
        target_email: email,
        action: "user_invited",
        details: {
          source: input.source,
          role: input.role,
          full_name: fullName,
          redirect_to: input.redirectTo,
          invited_by_email: input.actor?.email ?? null,
        },
      });

    if (eventError) {
      throw new InvitationStageError(
        "audit_event",
        `Invitation was sent, but its audit event could not be recorded: ${eventError.message}`,
      );
    }

    return {
      invitationId,
      invitedUserId,
      email,
      role: input.role,
    };
  } catch (error: unknown) {
    const stage =
      error instanceof InvitationStageError
        ? error.stage
        : "auth_invite";
    const message =
      error instanceof Error
        ? error.message
        : "Unknown invitation error.";

    await recordFailure({
      supabase,
      input,
      email,
      invitationId,
      invitedUserId,
      stage,
      message,
      markInvitationFailed: stage === "auth_invite",
    });

    if (stage === "auth_invite") {
      throw new PortalInvitationError(message, "email_error");
    }

    throw new PortalInvitationError(message, "database_error");
  }
}
