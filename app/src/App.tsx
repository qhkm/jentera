import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { useSnapshot } from '@/lib/repo';
import { RepositoryGate, useSignedIn } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { DetailLevelProvider } from '@/hooks/useDetailLevel';
import { isOnboarded } from '@/lib/business';
import Landing from '@/routes/Landing';
import Onboard from '@/routes/Onboard';
import SignIn from '@/routes/SignIn';
import Setup from '@/routes/Setup';
import Dashboard from '@/routes/Dashboard';
import type { ReactElement } from 'react';

/* ============================================================
   Flow gate. The static site did this with a redirect inside an
   inline <script>; as a route guard it runs once, client-side,
   with no hydration hazard.
   ============================================================ */
function RequireOnboarded({ children }: { children: ReactElement }) {
  const snap = useSnapshot();
  return isOnboarded(snap) ? children : <Navigate to="/onboard" replace />;
}

/**
 * Session gate for the dashboard.
 *
 * Distinct from RequireOnboarded, which only reads a localStorage flag —
 * that made /app reachable by setting `aisar-onboarded-v1` in devtools.
 * This asks whether the repository is actually server-backed.
 *
 * It is a convenience, not the security boundary: the API refuses every
 * unauthenticated call on its own, so bypassing this in the browser
 * yields an empty shell and a wall of 401s, not anyone's data.
 */
function RequireAuth({ children }: { children: ReactElement }) {
  return useSignedIn() ? children : <Navigate to="/signin" replace />;
}

/* ============================================================
   The authenticated subtree.

   A pathless layout route, so RepositoryGate mounts ONCE and stays
   mounted while its children swap through <Outlet />. Wrapping each
   route individually would remount the gate on every navigation and
   re-run choose() — an /api/me round trip plus a full snapshot reload
   between /onboard, /setup and /app.

   Landing and /signin sit outside it deliberately. They need no
   repository, and gating them would block first paint on the marketing
   page behind a cross-origin request — leaving it blank for as long as
   the API took to answer, or to time out if it were down.
   ============================================================ */
function AppShell() {
  return (
    <RepositoryGate>
      <I18nProvider>
        <ToastProvider>
          {/* Inside the gate, because it asks the repository what this
              person chose; above the routes, because the header toggle
              and the traces below it must read one value. */}
          <DetailLevelProvider>
            <Outlet />
          </DetailLevelProvider>
        </ToastProvider>
      </I18nProvider>
    </RepositoryGate>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public, and free of any provider dependency. */}
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />

        <Route element={<AppShell />}>
          {/* The no-signup demo. Anonymous on purpose: migrate.ts carries
              whatever is built here onto the server at first sign-in. */}
          <Route path="/onboard" element={<Onboard />} />
          <Route path="/setup" element={<Setup />} />
          <Route
            path="/app"
            element={
              /* Auth first, then onboarding: a signed-out visitor belongs
                 at /signin, not part-way through the demo. */
              <RequireAuth>
                <RequireOnboarded>
                  <Dashboard />
                </RequireOnboarded>
              </RequireAuth>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
