import { type NextRequest, NextResponse } from "next/server";

import type { AppRole } from "@/lib/auth/require-portal-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  invitePortalUser,
  PortalInvitationError,
} from "@/lib/users/invite-portal-user";

type PrivilegedActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
  status: "active";
};

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

function buildRedirectUrl(
  request: NextRequest,
  parameters: Record<string, string>,
): URL {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (host?.includes("localhost") ? "http" : "https");
  const origin = host
    ? `${protocol}://${host}`
    : new URL(request.url).origin;
  const url = new URL("/dashboard/users", origin);

  Object.entries(parameters).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

function redirectToUsers(
  request: NextRequest,
  parameters: Record<string, string>,
): NextResponse {
  return NextResponse.redirect(
    buildRedirectUrl(request, parameters),
    { status: 303 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const sessionClient = await createClient();
    const {
      data: claimsData,
      error: claimsError,
    } = await sessionClient.auth.getClaims();
    const userId = claimsData?.claims?.sub;

    if (claimsError || !userId) {
      return NextResponse.redirect(
        buildRedirectUrl(request, {
          error: "Your session has expired. Please sign in again.",
        }),
        { status: 303 },
      );
    }

    const { data: actorData, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, email, role, status")
      .eq("id", userId)
      .single();

    if (actorError || !actorData) {
      return redirectToUsers(request, {
        error: "Your portal profile could not be verified.",
      });
    }

    if (
      actorData.status !== "active" ||
      !["admin", "supervisor"].includes(actorData.role)
    ) {
      const usersUrl = buildRedirectUrl(request, {});

      return NextResponse.redirect(
        new URL("/dashboard", usersUrl.origin),
        { status: 303 },
      );
    }

    const formData = await request.formData();
    const fullName = String(formData.get("full_name") ?? "");
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "agent") as AppRole;
    const siteUrl = getRequiredEnvironmentVariable(
      "NEXT_PUBLIC_SITE_URL",
    ).replace(/\/$/, "");
    const adminClient = createAdminClient();
    const actor = actorData as PrivilegedActor;

    const result = await invitePortalUser(adminClient, {
      email,
      fullName,
      role,
      actor: {
        id: actor.id,
        email: actor.email,
        role: actor.role,
      },
      redirectTo: `${siteUrl}/auth/update-password`,
      source: "portal",
    });

    return redirectToUsers(request, {
      message: `Invitation sent to ${result.email}.`,
    });
  } catch (error: unknown) {
    const message =
      error instanceof PortalInvitationError || error instanceof Error
        ? error.message
        : "The invitation could not be sent.";

    return redirectToUsers(request, {
      error: message,
    });
  }
}
