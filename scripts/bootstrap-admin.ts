import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

const supabaseUrl = getRequiredEnvironmentVariable(
  "NEXT_PUBLIC_SUPABASE_URL",
);

const supabaseSecretKey = getRequiredEnvironmentVariable(
  "SUPABASE_SECRET_KEY",
);

const siteUrl = getRequiredEnvironmentVariable(
  "NEXT_PUBLIC_SITE_URL",
);

const email = "michael.j@techguys.work";
const fullName = "Michael J.";

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

async function bootstrapAdministrator() {
  console.log(`Sending administrator invitation to ${email}...`);

  const { data, error } =
    await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${siteUrl}/auth/update-password`,
        data: {
          full_name: fullName,
        },
      },
    );

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
      role: "admin",
      status: "invited",
    })
    .eq("id", userId);

  if (profileError) {
    throw new Error(
      `Invitation was sent, but the profile could not be updated: ${profileError.message}`,
    );
  }

  console.log("Administrator invitation sent successfully.");
  console.log("Profile role assigned: admin");
  console.log(`Password setup destination: ${siteUrl}/auth/update-password`);
}

bootstrapAdministrator().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown bootstrap error.";

  console.error(message);
  process.exitCode = 1;
});