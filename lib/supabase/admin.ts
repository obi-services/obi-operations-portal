import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Reads a required server environment variable.
 * Throws immediately if the variable is missing.
 */
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

/**
 * Creates a privileged Supabase client for trusted server-side operations.
 *
 * Never import this module into a Client Component.
 * The secret key bypasses Row Level Security.
 */
export function createAdminClient() {
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
