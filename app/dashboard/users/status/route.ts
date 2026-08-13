import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  changePortalUserStatus,
  PortalStatusChangeError,
  type StatusChangeActor,
} from "@/lib/users/change-portal-user-status";

function buildRedirectUrl(
  request: NextRequest,
  parameters: Record<string, string>,
): URL {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (host?.includes("localhost") || host?.startsWith("127.0.0.1")
      ? "http"
      : "https");
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
    const targetUserId = String(formData.get("target_user_id") ?? "");
    const action = String(formData.get("action") ?? "");
    const adminClient = createAdminClient();
    const actor = actorData as StatusChangeActor;

    const result = await changePortalUserStatus(adminClient, {
      actor,
      targetUserId,
      action,
    });

    revalidatePath("/dashboard/users");
    revalidatePath("/dashboard");

    return redirectToUsers(request, {
      message:
        result.newStatus === "suspended"
          ? `${result.fullName || result.email} has been suspended.`
          : `${result.fullName || result.email} has been reactivated.`,
    });
  } catch (error: unknown) {
    const message =
      error instanceof PortalStatusChangeError || error instanceof Error
        ? error.message
        : "The portal account status could not be changed.";

    return redirectToUsers(request, {
      error: message,
    });
  }
}
