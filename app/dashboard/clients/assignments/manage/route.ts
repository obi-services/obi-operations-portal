import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  assignPortalAgentToProject,
  PortalProjectAssignmentError,
  unassignPortalAgentFromProject,
} from "@/lib/assignments/manage-portal-project-assignment";

type PrivilegedActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
  status: "active";
};

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

  const url = new URL("/dashboard/clients", origin);

  Object.entries(parameters).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

function redirectToClients(
  request: NextRequest,
  parameters: Record<string, string>,
): NextResponse {
  return NextResponse.redirect(buildRedirectUrl(request, parameters), {
    status: 303,
  });
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
      return redirectToClients(request, {
        error: "Your portal profile could not be verified.",
      });
    }

    if (
      actorData.status !== "active" ||
      !["admin", "supervisor"].includes(actorData.role)
    ) {
      const clientsUrl = buildRedirectUrl(request, {});

      return NextResponse.redirect(
        new URL("/dashboard", clientsUrl.origin),
        { status: 303 },
      );
    }

    const actor = actorData as PrivilegedActor;
    const formData = await request.formData();
    const action = String(formData.get("action") ?? "");
    const adminClient = createAdminClient();

    if (action === "assign") {
      const result = await assignPortalAgentToProject(adminClient, {
        projectId: String(formData.get("project_id") ?? ""),
        agentUserId: String(formData.get("agent_user_id") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        actor,
      });

      revalidatePath("/dashboard/clients");

      return redirectToClients(request, {
        message: `${result.agentFullName || result.agentEmail} was assigned to ${result.externalProjectId}.`,
      });
    }

    if (action === "unassign") {
      const result = await unassignPortalAgentFromProject(adminClient, {
        assignmentId: String(formData.get("assignment_id") ?? ""),
        actor,
      });

      revalidatePath("/dashboard/clients");

      return redirectToClients(request, {
        message: `${result.agentFullName || result.agentEmail} was removed from ${result.externalProjectId}.`,
      });
    }

    throw new PortalProjectAssignmentError(
      "Select a valid project-assignment action.",
      "invalid_input",
    );
  } catch (error: unknown) {
    const message =
      error instanceof PortalProjectAssignmentError ||
      error instanceof Error
        ? error.message
        : "The project assignment could not be changed.";

    return redirectToClients(request, {
      error: message,
    });
  }
}