"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import type { NavIcon, NavItem } from "./navigation";

/** Orders lives at /admin, so it is current only on that exact path. Other items match their section. */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Admin shell: a 200px charcoal sidebar on desktop, and an off-canvas drawer below 768px.
 * Account actions are passed in from the server layout, so the session and sign-out stay server-rendered.
 */
export function AdminShell({
  items,
  user,
  signOutForm,
  children,
}: {
  items: readonly NavItem[];
  user: { displayName: string; role: string };
  signOutForm: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="adm">
      <a href="#main" className="adm-skip">
        Skip to content
      </a>

      <header className="adm-topbar">
        <button
          type="button"
          className="adm-burger"
          aria-expanded={open}
          aria-controls="adm-sidebar"
          onClick={() => setOpen((value) => !value)}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
          <span className="sr-only">{open ? "Close navigation" : "Open navigation"}</span>
        </button>
        <span className="adm-mark">Homivio</span>
      </header>

      <aside id="adm-sidebar" className="adm-sidebar" data-open={open ? "true" : "false"} aria-label="Admin navigation">
        <div className="adm-brand">
          <span className="adm-logo" aria-hidden="true">H</span>
          Homivio
        </div>

        <nav aria-label="Main">
          <ul className="adm-nav">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="adm-link"
                  aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.icon !== undefined ? <Glyph name={item.icon} /> : null}
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="adm-account">
          <span className="adm-avatar" aria-hidden="true">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="adm-name">{user.displayName}</p>
            <p className="adm-role">{user.role}</p>
          </div>
          <div className="w-full">{signOutForm}</div>
        </div>
      </aside>

      {open ? (
        <button type="button" className="adm-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />
      ) : null}

      <main id="main" className="adm-main">
        {children}
      </main>
    </div>
  );
}

function Glyph({ name }: { name: NavIcon }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="8" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="15" width="7" height="6" rx="1.5" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="4" cy="12" r="1" />
          <circle cx="4" cy="18" r="1" />
        </svg>
      );
    case "distribution":
      return (
        <svg {...common}>
          <path d="M4 6h4l8 12h4" />
          <path d="M4 18h4l2-3M14 9l2-3h4" />
        </svg>
      );
    case "rescue":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M5.6 5.6l3 3M15.4 15.4l3 3M18.4 5.6l-3 3M8.6 15.4l-3 3" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
  }
}
