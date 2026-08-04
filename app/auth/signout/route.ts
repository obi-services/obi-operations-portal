import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    await supabase.auth.signOut({
      scope: "local",
    });
  }

  revalidatePath("/", "layout");

  const forwardedHost =
    request.headers.get("x-forwarded-host");

  const host =
    forwardedHost ??
    request.headers.get("host");

  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (host?.includes("localhost") ? "http" : "https");

  const loginUrl = host
    ? `${protocol}://${host}/auth/login`
    : new URL("/auth/login", request.url).toString();

  return NextResponse.redirect(loginUrl, {
    status: 303,
  });
}