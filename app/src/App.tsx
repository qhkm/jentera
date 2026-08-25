import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RepositoryProvider } from '@/lib/repo';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { isOnboarded } from '@/lib/business';
import Landing from '@/routes/Landing';
import Onboard from '@/routes/Onboard';
import Setup from '@/routes/Setup';
import Dashboard from '@/routes/Dashboard';
import type { ReactElement } from 'react';

/* ============================================================
   Flow gate. The static site did this with a redirect inside an
   inline <script>; as a route guard it runs once, client-side,
   with no hydration hazard.
   ============================================================ */
function RequireOnboarded({ children }: { children: ReactElement }) {
  return isOnboarded() ? children : <Navigate to="/onboard" replace />;
}

export default function App() {
  return (
    <RepositoryProvider>
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/onboard" element={<Onboard />} />
          <Route path="/setup" element={<Setup />} />
          <Route
            path="/app"
            element={
              <RequireOnboarded>
                <Dashboard />
              </RequireOnboarded>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
    </RepositoryProvider>
  );
}
