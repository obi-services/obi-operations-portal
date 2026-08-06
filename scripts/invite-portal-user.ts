import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import type { AppRole } from "../lib/auth/require-portal-profile";
import {
  invitePortalUser,
  type InvitationActor,
} from "../lib/users/invite-portal-user";

loadEnvConfig(process.cwd());

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


function createCliAdminClient() {
  return createClient(
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
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown invitation error.";
}

const email = getArgument("email");
const fullName = getArgument("name");
const role = getArgument("role") as AppRole;
const invitedByEmail = getArgument("invited-by-email").toLowerCase();

async function resolveActorProfile(): Promise<InvitationActor | null> {
  if (!invitedByEmail) {
    return null;
  }

  const supabase = createCliAdminClient();
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

  if (
    data.status !== "active" ||
    !["admin", "supervisor"].includes(data.role)
  ) {
    throw new Error(
      "The inviting user must be an active Admin or Supervisor.",
    );
  }

  return {
    id: data.id as string,
    email: data.email as string,
    role: data.role as "admin" | "supervisor",
  };
}

async function main(): Promise<void> {
  const siteUrl = requiredEnv("NEXT_PUBLIC_SITE_URL").replace(/\/$/, "");
  const actor = await resolveActorProfile();
  const supabase = createCliAdminClient();

  console.log(`Preparing invitation for ${email} as ${role}...`);
  console.log("Sending the Supabase invitation email...");

  const result = await invitePortalUser(supabase, {
    email,
    fullName,
    role,
    actor,
    redirectTo: `${siteUrl}/auth/update-password`,
    source: "cli",
  });

  console.log("Portal invitation sent successfully.");
  console.log(`Invitation ID: ${result.invitationId}`);
  console.log(`Invited user ID: ${result.invitedUserId}`);
  console.log(`Email: ${result.email}`);
  console.log(`Role: ${result.role}`);
  console.log(`Invited by: ${actor?.email ?? "System / CLI"}`);
  console.log(`Password setup: ${siteUrl}/auth/update-password`);
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
