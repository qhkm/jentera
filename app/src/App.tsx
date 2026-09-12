import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import * as store from '@/lib/storage';
import { useSnapshot } from '@/lib/repo';
import { RepositoryGate, useSignedIn } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { DetailLevelProvider } from '@/hooks/useDetailLevel';
import { ActivityProvider } from '@/hooks/useActivity';
import { isOnboarded, isSetupDone } from '@/lib/business';
import Landing from '@/routes/Landing';
import SignIn from '@/routes/SignIn';
import Join from '@/routes/Join';
import Connect from '@/routes/Connect';
import NotFound from '@/routes/NotFound';
import { PageMetadata } from '@/components/PageMetadata';
import { PageLoading } from '@/components/ui';
import { lazy, Suspense, type ReactElement } from 'react';

// Visitors should not download the whole dashboard before reading the site.
// Keep sign-in eager: it is the primary CTA and the release verifier checks
// the entry bundle for its auth endpoint.
const Onboard = lazy(() => import('@/routes/Onboard'));
const Setup = lazy(() => import('@/routes/Setup'));
const Dashboard = lazy(() => import('@/routes/Dashboard'));

function RouteLoading() {
  return <PageLoading title="Loading your page…" />;
}

/* ============================================================
   Flow gate. The static site did this with a redirect inside an
   inline <script>; as a route guard it runs once, client-side,
   with no hydration hazard.
   ============================================================ */
function RequireOnboarded({ children }: { children: ReactElement }) {
  const snap = useSnapshot();
  if (!isOnboarded(snap)) return <Navigate to="/onboard" replace />;
  return isSetupDone(snap) ? children : <Navigate to="/setup" replace />;
}

/** Keep each lifecycle URL honest when it is opened directly or restored
    from browser history. Authentication chooses the first destination, but
    these guards remain necessary after state changes inside the SPA. */
export function OnboardingStage() {
  const snap = useSnapshot();
  /* An invited person signs in with no business and lands here. Their way
     in is the invitation waiting in this browser, not a new business. */
  if (store.get(store.KEYS.joinToken)) return <Navigate to="/join" replace />;
  if (!isOnboarded(snap)) return <Onboard />;
  return <Navigate to={isSetupDone(snap) ? '/app' : '/setup'} replace />;
}

function SetupStage() {
  const snap = useSnapshot();
  return isOnboarded(snap) ? <Setup /> : <Navigate to="/onboard" replace />;
}

/**
 * Session gate for the dashboard.
 *
 * Distinct from RequireOnboarded, which reads the loaded business state —
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

export function AppRoutes() {
  return (
    <>
      <PageMetadata />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          {/* Public, and free of any provider dependency. */}
          <Route path="/" element={<Landing />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/join" element={<Join />} />

          <Route element={<AppShell />}>
            {/* The no-signup demo. Anonymous on purpose: migrate.ts carries
              whatever is built here onto the server at first sign-in. */}
            <Route path="/onboard" element={<OnboardingStage />} />
            <Route path="/setup" element={<SetupStage />} />
            <Route
              path="/app"
              element={
                /* Auth first, then onboarding: a signed-out visitor belongs
                 at /signin, not part-way through the demo. */
                <RequireAuth>
                  <RequireOnboarded>
                    {/* One activity fetch for the whole dashboard. The
                      sidebar, Home and Activity all read it, and all
                      three settle at the same moment. */}
                    <ActivityProvider>
                      <Dashboard />
                    </ActivityProvider>
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
