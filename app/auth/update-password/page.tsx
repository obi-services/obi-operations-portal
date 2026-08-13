"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isInitializing, setIsInitializing] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [invitationEmail, setInvitationEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let isCancelled = false;

    async function initializeInvitationSession() {
      setErrorMessage("");
      setIsInitializing(true);
      setIsReady(false);

      /*
       * Invitation tokens take priority over any session that may already
       * exist in this browser. This prevents an invitation opened while
       * another portal user is signed in from changing the wrong account's
       * password.
       */
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.substring(1)
        : window.location.hash;

      const parameters = new URLSearchParams(hash);

      const authError =
        parameters.get("error_description") ?? parameters.get("error");

      if (authError) {
        if (!isCancelled) {
          setErrorMessage(authError);
          setIsInitializing(false);
        }

        return;
      }

      const accessToken = parameters.get("access_token");
      const refreshToken = parameters.get("refresh_token");
      const authType = parameters.get("type");
      const hasInvitationTokens = Boolean(accessToken || refreshToken);

      if (hasInvitationTokens) {
        if (!accessToken || !refreshToken) {
          if (!isCancelled) {
            setErrorMessage(
              "The invitation session is incomplete. Please request a new invitation.",
            );
            setIsInitializing(false);
          }

          return;
        }

        if (authType && authType !== "invite") {
          if (!isCancelled) {
            setErrorMessage(
              "This link is not a valid portal invitation. Please request a new invitation.",
            );
            setIsInitializing(false);
          }

          return;
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

        if (sessionError || !sessionData.session) {
          if (!isCancelled) {
            setErrorMessage(
              sessionError?.message ??
                "The invitation session could not be established.",
            );
            setIsInitializing(false);
          }

          return;
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          if (!isCancelled) {
            setErrorMessage(
              userError?.message ??
                "The invitation session could not be verified.",
            );
            setIsInitializing(false);
          }

          return;
        }

        /*
         * Remove sensitive invitation tokens from the visible browser URL
         * only after the invitation session has been established.
         */
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}`,
        );

        if (!isCancelled) {
          setInvitationEmail(user.email ?? "");
          setIsReady(true);
          setIsInitializing(false);
        }

        return;
      }

      /*
       * If the invitation session was already established and the page was
       * refreshed after the URL fragment was removed, allow that verified
       * browser session to continue.
       */
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();

      if (!existingSession) {
        if (!isCancelled) {
          setErrorMessage(
            "The invitation session is missing or has expired. Please request a new invitation.",
          );
          setIsInitializing(false);
        }

        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        if (!isCancelled) {
          setErrorMessage(
            userError?.message ?? "The invitation session is no longer valid.",
          );
          setIsInitializing(false);
        }

        return;
      }

      if (!isCancelled) {
        setInvitationEmail(user.email ?? "");
        setIsReady(true);
        setIsInitializing(false);
      }
    }

    void initializeInvitationSession();

    return () => {
      isCancelled = true;
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (!isReady) {
      setErrorMessage("Your invitation session has not been established.");
      return;
    }

    if (password.length < 10) {
      setErrorMessage("Your password must contain at least 10 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setIsSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage(
        userError?.message ?? "The invitation session is no longer valid.",
      );
      setIsSaving(false);
      return;
    }

    if (
      invitationEmail &&
      user.email &&
      user.email.toLowerCase() !== invitationEmail.toLowerCase()
    ) {
      setErrorMessage(
        "The invitation session changed unexpectedly. Please reopen the invitation email and try again.",
      );
      setIsSaving(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setErrorMessage(updateError.message);
      setIsSaving(false);
      return;
    }

    setSuccessMessage(
      "Your password was created successfully. Redirecting to login...",
    );

    await supabase.auth.signOut();

    window.setTimeout(() => {
      router.replace(
        "/auth/login?message=Password created successfully. Please sign in.",
      );
      router.refresh();
    }, 1200);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <section className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 p-7 shadow-xl">
        <h1 className="text-2xl font-bold">Create Your Password</h1>

        <p className="mt-2 text-sm text-neutral-400">
          Create the password you will use to access the OBI Operations Portal.
        </p>

        {invitationEmail && isReady && (
          <p className="mt-3 text-xs text-neutral-500">
            Setting up access for {invitationEmail}
          </p>
        )}

        {isInitializing && (
          <p className="mt-6 text-sm text-neutral-300">
            Verifying your invitation...
          </p>
        )}

        {!isInitializing && errorMessage && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          >
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mt-6 rounded-md border border-green-900 bg-green-950/40 px-4 py-3 text-sm text-green-300"
          >
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium"
            >
              New password
            </label>

            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={!isReady || isSaving}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-3 outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-2 block text-sm font-medium"
            >
              Confirm password
            </label>

            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={!isReady || isSaving}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-3 outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={!isReady || isSaving}
            className="w-full rounded-md bg-orange-500 px-4 py-3 font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Creating password..." : "Create password"}
          </button>
        </form>
      </section>
    </main>
  );
}
