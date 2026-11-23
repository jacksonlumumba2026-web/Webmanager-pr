import React, { Component, Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { OfflineIndicator } from './components/common/OfflineIndicator.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';

function lazyWithRetry<T extends React.ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const delays = [400, 1000, 2000];
    let lastErr: unknown;
    for (let i = 0; i <= delays.length; i += 1) {
      try {
        return await importer();
      } catch (err) {
        lastErr = err;
        if (i < delays.length) {
          await new Promise((r) => setTimeout(r, delays[i]));
        }
      }
    }
    throw lastErr;
  });
}

const HomePage = lazyWithRetry(() =>
  import('./pages/public/HomePage.tsx').then((m) => ({ default: m.HomePage }))
);
const AboutPage = lazyWithRetry(() =>
  import('./pages/public/AboutPage.tsx').then((m) => ({ default: m.AboutPage }))
);
const FeaturesPage = lazyWithRetry(() =>
  import('./pages/public/FeaturesPage.tsx').then((m) => ({ default: m.FeaturesPage }))
);
const PricingPage = lazyWithRetry(() =>
  import('./pages/public/PricingPage.tsx').then((m) => ({ default: m.PricingPage }))
);
const ContactPage = lazyWithRetry(() =>
  import('./pages/public/ContactPage.tsx').then((m) => ({ default: m.ContactPage }))
);
const LoginPage = lazyWithRetry(() =>
  import('./pages/auth/LoginPage.tsx').then((m) => ({ default: m.LoginPage }))
);
const RegisterPage = lazyWithRetry(() =>
  import('./pages/auth/RegisterPage.tsx').then((m) => ({ default: m.RegisterPage }))
);
const InvitePage = lazyWithRetry(() =>
  import('./pages/auth/InvitePage.tsx').then((m) => ({ default: m.InvitePage }))
);
const AdminOverviewPage = lazyWithRetry(() =>
  import('./pages/admin/AdminOverviewPage.tsx').then((m) => ({ default: m.AdminOverviewPage }))
);
const ClientsPage = lazyWithRetry(() =>
  import('./pages/admin/ClientsPage.tsx').then((m) => ({ default: m.ClientsPage }))
);
const ClientDetailPage = lazyWithRetry(() =>
  import('./pages/admin/ClientDetailPage.tsx').then((m) => ({ default: m.ClientDetailPage }))
);
const WebsitesPage = lazyWithRetry(() =>
  import('./pages/admin/WebsitesPage.tsx').then((m) => ({ default: m.WebsitesPage }))
);
const StaffPage = lazyWithRetry(() =>
  import('./pages/admin/StaffPage.tsx').then((m) => ({ default: m.StaffPage }))
);
const ActivityLogsPage = lazyWithRetry(() =>
  import('./pages/admin/ActivityLogsPage.tsx').then((m) => ({ default: m.ActivityLogsPage }))
);
const SettingsPage = lazyWithRetry(() =>
  import('./pages/admin/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage }))
);
const WebsiteDetailPage = lazyWithRetry(() =>
  import('./pages/websites/WebsiteDetailPage.tsx').then((m) => ({ default: m.WebsiteDetailPage }))
);
const ClientPortalPage = lazyWithRetry(() =>
  import('./pages/client/ClientPortalPage.tsx').then((m) => ({ default: m.ClientPortalPage }))
);
const ClientAccountPage = lazyWithRetry(() =>
  import('./pages/client/ClientAccountPage.tsx').then((m) => ({ default: m.ClientAccountPage }))
);
const ChangeRequestsPage = lazyWithRetry(() =>
  import('./pages/requests/ChangeRequestsPage.tsx').then((m) => ({ default: m.ChangeRequestsPage }))
);
const BillingPage = lazyWithRetry(() =>
  import('./pages/billing/BillingPage.tsx').then((m) => ({ default: m.BillingPage }))
);

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
        <span>Loading page…</span>
      </div>
    </div>
  );
}

class ChunkErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
          <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-6 text-center space-y-4">
            <h1 className="text-lg font-bold text-slate-900">Connection interrupted</h1>
            <p className="text-sm text-slate-600">
              This page could not finish downloading over your current connection. Check your signal and retry.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              Retry Loading
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: 'admin_or_staff' | 'admin' | 'client';
}) {
  const { loading, authenticated, isAdminOrStaff, isAdmin, isClient } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-sm text-slate-600">
        Loading WebManager Pro...
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireRole === 'admin_or_staff' && !isAdminOrStaff) {
    return <Navigate to="/portal" replace />;
  }
  if (requireRole === 'admin' && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  if (requireRole === 'client' && !isClient && isAdminOrStaff) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ChunkErrorBoundary>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              {/* Public Marketing Routes */}
              <Route path="/" element={<HomePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/features" element={<FeaturesPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/contact" element={<ContactPage />} />

              {/* Authentication & Invitation Onboarding */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/invite/:token" element={<InvitePage />} />

              {/* Administrator & Staff Dashboard */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <AdminOverviewPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/clients"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <ClientsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/clients/:id"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <ClientDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/websites"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <WebsitesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/requests"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <ChangeRequestsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/billing"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <BillingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/staff"
                element={
                  <ProtectedRoute requireRole="admin">
                    <StaffPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/activity"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <ActivityLogsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/settings"
                element={
                  <ProtectedRoute requireRole="admin_or_staff">
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* Shared Website Workspace (RBAC-enforced on API) */}
              <Route
                path="/websites/:id"
                element={
                  <ProtectedRoute>
                    <WebsiteDetailPage />
                  </ProtectedRoute>
                }
              />

              {/* Client Portal */}
              <Route
                path="/portal"
                element={
                  <ProtectedRoute requireRole="client">
                    <ClientPortalPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portal/requests"
                element={
                  <ProtectedRoute requireRole="client">
                    <ChangeRequestsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portal/billing"
                element={
                  <ProtectedRoute requireRole="client">
                    <BillingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portal/activity"
                element={
                  <ProtectedRoute requireRole="client">
                    <ActivityLogsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portal/account"
                element={
                  <ProtectedRoute requireRole="client">
                    <ClientAccountPage />
                  </ProtectedRoute>
                }
              />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ChunkErrorBoundary>
        <OfflineIndicator />
      </BrowserRouter>
    </AuthProvider>
  );
}

