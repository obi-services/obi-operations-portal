import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

type PortalRole = "admin" | "supervisor" | "agent";

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

const email = getArgument("email").toLowerCase();
const fullName = getArgument("name");
const role = getArgument("role") as PortalRole;

if (!email) {
  throw new Error("Missing --email argument.");
}

if (!fullName) {
  throw new Error("Missing --name argument.");
}

if (!["admin", "supervisor", "agent"].includes(role)) {
  throw new Error(
    "The --role argument must be admin, supervisor, or agent.",
  );
}

const siteUrl = requiredEnv("NEXT_PUBLIC_SITE_URL").replace(
  /\/$/,
  "",
);

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

async function main(): Promise<void> {
  console.log(`Inviting ${email} as ${role}...`);

  const { data, error } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/update-password`,
      data: {
        full_name: fullName,
        role,
      },
    });

  if (error) {
    throw new Error(
      `Unable to send invitation: ${error.message}`,
    );
  }

  const userId = data.user?.id;

  if (!userId) {
    throw new Error(
      "Supabase did not return the invited user ID.",
    );
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      role,
      status: "invited",
    })
    .eq("id", userId);

  if (profileError) {
    throw new Error(
      `Invitation was sent, but the profile could not be updated: ${profileError.message}`,
    );
  }

  console.log("Portal invitation sent successfully.");
  console.log(`Email: ${email}`);
  console.log(`Role: ${role}`);
  console.log(
    `Password setup: ${siteUrl}/auth/update-password`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown invitation error.";

  console.error(message);
  process.exitCode = 1;
});
