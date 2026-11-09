"use client";

import { useFormStatus } from "react-dom";

/** Disables itself while its form is submitting, so one click cannot send a second request. */
export function SubmitButton({
  label,
  pendingLabel = "Saving…",
  variant = "btn-primary",
  disabled = false,
  name,
  value,
}: {
  label: string;
  pendingLabel?: string;
  variant?: "btn-primary" | "btn-ghost";
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`btn ${variant}`}
      disabled={disabled || pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
