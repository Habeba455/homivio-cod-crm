/**
 * Fallback for navigations between protected pages. The session and role are read at request time by the
 * page's guard (requireArea), so this boundary lets the navigation show a placeholder instead of blocking.
 * It must stay free of user data: it renders before the session is checked.
 */
export default function ProtectedLoading() {
  return (
    <div className="min-h-dvh bg-background" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
    </div>
  );
}
