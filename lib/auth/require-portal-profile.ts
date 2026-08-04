import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "supervisor" | "agent";

export type AccountStatus =
  | "invited"
  | "active"
  | "inactive"
  | "suspended";

export type PortalProfile = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
};

/**
 * Returns the currently authenticated and active portal profile.
 *
 * Users without a valid session are redirected to login.
 * Inactive, suspended, or incomplete accounts are blocked.
 */
export async function requirePortalProfile(): Promise<PortalProfile> {
  const supabase = await createClient();

  const {
    data: claimsData,
    error: claimsError,
  } = await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    redirect("/auth/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    redirect(
      "/auth/error?error=Your portal profile could not be found.",
    );
  }

  if (profile.status !== "active") {
    redirect(
      `/auth/error?error=${encodeURIComponent(
        `Your account is currently ${profile.status}. Please contact an administrator.`,
      )}`,
    );
  }

  return profile as PortalProfile;
}