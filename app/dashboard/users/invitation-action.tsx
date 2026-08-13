"use client";

export type InvitationActionProps = {
  invitationId: string;
  email: string;
  action: "resend" | "revoke";
};

export function InvitationAction({
  invitationId,
  email,
  action,
}: InvitationActionProps) {
  const isRevoke = action === "revoke";

  return (
    <form
      action="/dashboard/users/invitation"
      method="post"
      onSubmit={(event) => {
        const confirmed = window.confirm(
          isRevoke
            ? `Revoke the pending invitation for ${email}? The existing invitation link will no longer be usable.`
            : `Resend the invitation to ${email}? The previous invitation link will be replaced.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invitation_id" value={invitationId} />
      <input type="hidden" name="action" value={action} />
      <button
        type="submit"
        className={
          isRevoke
            ? "rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/60"
            : "rounded-md border border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-[#fd961b] hover:text-[#fd961b]"
        }
      >
        {isRevoke ? "Revoke" : "Resend"}
      </button>
    </form>
  );
}
