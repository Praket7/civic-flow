import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { HelpProvider } from "../components/help/HelpDialog";
import { FirstRunTour } from "../components/help/FirstRunTour";
import { CommandPalette } from "../components/navigation/CommandPalette";
import { Sidebar } from "../components/navigation/Sidebar";
import { TopBar } from "../components/navigation/TopBar";
import { useAuth } from "../lib/auth/session";
import { useLocale } from "../lib/i18n";
import styles from "./AppShell.module.css";

const COLLAPSE_KEY = "civicflow.sidebar.collapsed";

export function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const { locale, version } = useLocale();
  const copyKey = `${locale}:${version}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [mobilePath, setMobilePath] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const routeIdentity = `${location.key}:${location.pathname}`;
  const mobileOpen = narrow && mobilePath === routeIdentity;
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreDrawerFocus = useRef(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const role: "coordinator" | "volunteer" =
    user?.role === "coordinator" ? "coordinator" : "volunteer";
  // The native end-to-end suite drives the app through WebDriver; a teaching
  // card over the first screen would be noise there. Unit tests do not mount
  // the shell's tour either; the tour has its own test.
  const showTour =
    typeof navigator === "undefined" || (!navigator.webdriver && import.meta.env.MODE !== "test");
  // Check-in owns the full content frame: no global top bar and no canvas
  // padding, because it is used one-handed at a door.
  const surface = location.pathname === "/volunteer/check-in" ? "checkin" : undefined;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    function update() {
      setNarrow(media.matches);
      if (!media.matches) setMobilePath(null);
    }
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    const frame = requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: 0, behavior: "instant" });
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  const dismissMobile = useCallback(() => {
    restoreDrawerFocus.current = true;
    setMobilePath(null);
  }, []);

  useEffect(() => {
    if (mobileOpen || !restoreDrawerFocus.current) return;
    restoreDrawerFocus.current = false;
    sidebarTriggerRef.current?.focus({ preventScroll: true });
  }, [mobileOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !mobileOpen &&
        !event.defaultPrevented &&
        !(event.target instanceof HTMLElement && event.target.closest('[aria-modal="true"]')) &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, String(!value));
      } catch {
        // Preference is best effort; the rail still works for this session.
      }
      return !value;
    });
  }

  return (
    <HelpProvider>
      <div className={`shell ${styles.shell}`} data-collapsed={collapsed}>
        <a
          className={styles.skipLink}
          href="#main-content"
          inert={mobileOpen}
          onClick={(event) => {
            event.preventDefault();
            mainRef.current?.focus();
          }}
        >
          Skip to main content
        </a>
        <Sidebar
          key={`sidebar-${copyKey}`}
          role={role}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          narrow={narrow}
          onToggleCollapsed={toggleCollapsed}
          onDismissMobile={dismissMobile}
          onNavigate={() => {
            if (mobileOpen) setMobilePath(null);
          }}
        />
        <div className={styles.main} data-surface={surface} inert={mobileOpen}>
          {surface ? null : (
            <TopBar
              key={`topbar-${copyKey}`}
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenSidebar={() => setMobilePath(routeIdentity)}
              sidebarTriggerRef={sidebarTriggerRef}
              sidebarOpen={mobileOpen}
            />
          )}
          <main
            ref={mainRef}
            id="main-content"
            className={styles.content}
            data-surface={surface}
            tabIndex={-1}
          >
            {showTour && !surface ? <FirstRunTour key={role} role={role} /> : null}
            <div key={location.pathname} className={styles.pageTransition}>
              <Fragment key={copyKey}>
                <Outlet />
              </Fragment>
            </div>
          </main>
        </div>
        <CommandPalette
          key={`palette-${copyKey}`}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
      </div>
    </HelpProvider>
  );
}
