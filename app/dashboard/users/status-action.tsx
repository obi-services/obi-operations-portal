"use client";

export type UserStatusActionProps = {
  targetUserId: string;
  targetName: string;
  action: "suspend" | "reactivate";
};

export function UserStatusAction({
  targetUserId,
  targetName,
  action,
}: UserStatusActionProps) {
  const isSuspend = action === "suspend";

  return (
    <form
      action="/dashboard/users/status"
      method="post"
      onSubmit={(event) => {
        const confirmed = window.confirm(
          isSuspend
            ? `Suspend ${targetName}? Their portal access will be blocked by the account-status checks.`
            : `Reactivate ${targetName}? They will regain portal access using their existing credentials.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="target_user_id" value={targetUserId} />
      <input type="hidden" name="action" value={action} />
      <button
        type="submit"
        className={
          isSuspend
            ? "rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/60"
            : "rounded-md border border-green-900 bg-green-950/30 px-3 py-2 text-xs font-semibold text-green-300 transition hover:bg-green-950/60"
        }
      >
        {isSuspend ? "Suspend" : "Reactivate"}
      </button>
    </form>
  );
}
