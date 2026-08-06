import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

type PortalRole = "admin" | "supervisor" | "agent";
type FailureStage =
  | "auth_invite"
  | "invitation_update"
  | "profile_update"
  | "audit_event";

type ActorProfile = {
  id: string;
  email: string;
  role: PortalRole;
  status: string;
};

const allowedRoles: PortalRole[] = [
  "admin",
  "supervisor",
  "agent",
];

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

function getArgument(name: string): string {
  const key = `--${name}`;
  const inline = process.argv.find((value) =>
    value.startsWith(`${key}=`),
  );

  if (inline) {
    return inline.slice(key.length + 1).trim();
  }

  const index = process.argv.indexOf(key);

  if (index === -1) {
    return "";
  }

  return (process.argv[index + 1] ?? "").trim();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown invitation error.";
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

const email = getArgument("email").toLowerCase();
const fullName = getArgument("name");
const roleArgument = getArgument("role");
const invitedByEmail = getArgument(
  "invited-by-email",
).toLowerCase();

if (!email) {
  throw new Error("Missing --email argument.");
}

if (!fullName) {
  throw new Error("Missing --name argument.");
}

if (!allowedRoles.includes(roleArgument as PortalRole)) {
  throw new Error(
    "The --role argument must be admin, supervisor, or agent.",
  );
}

const role = roleArgument as PortalRole;
const siteUrl = requiredEnv("NEXT_PUBLIC_SITE_URL").replace(
  /\/$/,
  "",
);
const redirectTo = `${siteUrl}/auth/update-password`;

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SECRET_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

async function resolveActorProfile(): Promise<ActorProfile | null> {
  if (!invitedByEmail) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, status")
    .eq("email", invitedByEmail)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to verify the inviting user: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      `No portal profile exists for inviting user ${invitedByEmail}.`,
    );
  }

  const actor = data as ActorProfile;

  if (
    actor.status !== "active" ||
    !["admin", "supervisor"].includes(actor.role)
  ) {
    throw new Error(
      "The inviting user must be an active Admin or Supervisor.",
    );
  }

  return actor;
}

async function assertTargetDoesNotExist(): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, status")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to check the existing portal profile: ${error.message}`,
    );
  }

  if (data) {
    throw new Error(
      `A portal profile already exists for ${email}. Use user management instead of sending a new invitation.`,
    );
  }
}

async function assertNoPendingInvitation(): Promise<void> {
  const { data, error } = await supabase
    .from("user_invitations")
    .select("id, sent_at, invited_user_id")
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to check pending invitations: ${error.message}`,
    );
  }

  if (data) {
    throw new Error(
      `A pending invitation already exists for ${email}. Do not create a duplicate invitation.`,
    );
  }
}

async function createPendingInvitation(
  actor: ActorProfile | null,
): Promise<string> {
  const { data, error } = await supabase
    .from("user_invitations")
    .insert({
      email,
      full_name: fullName,
      role,
      status: "pending",
      invited_by: actor?.id ?? null,
      metadata: {
        source: "cli",
        redirect_to: redirectTo,
        invited_by_email: actor?.email ?? null,
        stage: "created",
      },
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        `A pending invitation already exists for ${email}.`,
      );
    }

    throw new Error(
      `Unable to create the invitation record: ${error.message}`,
    );
  }

  return data.id as string;
}

async function recordFailure(options: {
  actor: ActorProfile | null;
  invitationId: string;
  invitedUserId: string | null;
  stage: FailureStage;
  message: string;
  markInvitationFailed: boolean;
}): Promise<void> {
  const failureMessage = options.message.slice(0, 4000);

  const { error: invitationError } = await supabase
    .from("user_invitations")
    .update({
      status: options.markInvitationFailed
        ? "failed"
        : "pending",
      invited_user_id: options.invitedUserId,
      failure_message: failureMessage,
      metadata: {
        source: "cli",
        redirect_to: redirectTo,
        invited_by_email: options.actor?.email ?? null,
        stage: options.stage,
      },
    })
    .eq("id", options.invitationId);

  if (invitationError) {
    console.error(
      `Warning: unable to update the failed invitation record: ${invitationError.message}`,
    );
  }

  const { error: eventError } = await supabase
    .from("user_management_events")
    .insert({
      actor_user_id: options.actor?.id ?? null,
      target_user_id: null,
      invitation_id: options.invitationId,
      target_email: email,
      action: "invitation_failed",
      details: {
        source: "cli",
        stage: options.stage,
        role,
        auth_user_id: options.invitedUserId,
        message: failureMessage,
      },
    });

  if (eventError) {
    console.error(
      `Warning: unable to create the failure audit event: ${eventError.message}`,
    );
  }
}

async function main(): Promise<void> {
  console.log(`Preparing invitation for ${email} as ${role}...`);

  const actor = await resolveActorProfile();

  await assertTargetDoesNotExist();
  await assertNoPendingInvitation();

  const invitationId = await createPendingInvitation(actor);
  let invitedUserId: string | null = null;

  try {
    console.log("Sending the Supabase invitation email...");

    const { data, error } =
      await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          full_name: fullName,
          role,
          invited_by: actor?.id ?? null,
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
          source: "cli",
          redirect_to: redirectTo,
          invited_by_email: actor?.email ?? null,
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
        role,
        status: "invited",
        invited_by: actor?.id ?? null,
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
        actor_user_id: actor?.id ?? null,
        target_user_id: invitedUserId,
        invitation_id: invitationId,
        target_email: email,
        action: "user_invited",
        details: {
          source: "cli",
          role,
          full_name: fullName,
          redirect_to: redirectTo,
          invited_by_email: actor?.email ?? null,
        },
      });

    if (eventError) {
      throw new InvitationStageError(
        "audit_event",
        `Invitation was sent, but its audit event could not be recorded: ${eventError.message}`,
      );
    }

    console.log("Portal invitation sent successfully.");
    console.log(`Invitation ID: ${invitationId}`);
    console.log(`Invited user ID: ${invitedUserId}`);
    console.log(`Email: ${email}`);
    console.log(`Role: ${role}`);
    console.log(
      `Invited by: ${actor?.email ?? "System / CLI"}`,
    );
    console.log(`Password setup: ${redirectTo}`);
  } catch (error: unknown) {
    const stage =
      error instanceof InvitationStageError
        ? error.stage
        : "auth_invite";
    const message = getErrorMessage(error);

    await recordFailure({
      actor,
      invitationId,
      invitedUserId,
      stage,
      message,
      markInvitationFailed: stage === "auth_invite",
    });

    throw new Error(message);
  }
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
