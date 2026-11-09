/** Shows the outcome of the last action. Errors use the alert style; success is announced politely. */
export function ActionMessage({ ok, message }: { ok: boolean; message: string | null }) {
  if (message === null) return null;
  if (!ok) {
    return (
      <p role="alert" className="alert-error">
        {message}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm font-medium text-emerald-700">
      {message}
    </p>
  );
}
