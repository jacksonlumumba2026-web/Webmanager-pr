import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  FileCode2,
  FolderGit2,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquarePlus,
  Receipt,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { PWAInstallButton } from '../common/PWAInstallButton.tsx';

interface DashboardLayoutProps {
  breadcrumbs: Array<{ label: string; to?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardLayout({ breadcrumbs, action, children }: DashboardLayoutProps) {
  const { profile, organization, isAdminOrStaff, isAdmin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const brandName = organization?.name || 'WebManager Pro';
  const accentColor = organization?.accentColor || '#1D4ED8';

  const adminNav = [
    { label: 'Overview', to: '/dashboard', icon: LayoutDashboard, exact: true },
    { label: 'Clients', to: '/dashboard/clients', icon: Users },
    { label: 'Websites', to: '/dashboard/websites', icon: Globe },
    { label: 'Change Requests', to: '/dashboard/requests', icon: MessageSquarePlus },
    { label: 'Billing & Invoices', to: '/dashboard/billing', icon: Receipt },
    ...(isAdmin ? [{ label: 'Staff & Roles', to: '/dashboard/staff', icon: ShieldCheck }] : []),
    { label: 'Activity Logs', to: '/dashboard/activity', icon: Activity },
    { label: 'Settings & Branding', to: '/dashboard/settings', icon: Settings },
  ];

  const clientNav = [
    { label: 'My Websites', to: '/portal', icon: Globe, exact: true },
    { label: 'Change Requests', to: '/portal/requests', icon: MessageSquarePlus },
    { label: 'Billing & Invoices', to: '/portal/billing', icon: Receipt },
    { label: 'Activity History', to: '/portal/activity', icon: Activity },
    { label: 'Account & Security', to: '/portal/account', icon: UserCircle },
  ];

  const navItems = isAdminOrStaff ? adminNav : clientNav;

  const isActivePath = (item: { to: string; exact?: boolean }) => {
    if (item.exact) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 w-64">
      <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-3 shrink-0">
        {organization?.brandLogoUrl ? (
          <img
            src={organization.brandLogoUrl}
            alt={brandName}
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded object-contain bg-white border border-slate-200 shrink-0"
          />
        ) : (
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: accentColor }}
          >
            {brandName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-bold text-slate-900 truncate">{brandName}</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Workspace navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(item);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
              }`}
            >
              <Icon
                className="w-4 h-4 shrink-0"
                style={active ? { color: accentColor } : undefined}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}

        {isAdminOrStaff && (
          <div className="pt-4 mt-4 border-t border-slate-200 space-y-1">
            <p className="px-3 py-1 text-xs font-medium text-slate-500">Workspace Shortcuts</p>
            <Link
              to="/dashboard/websites"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
            >
              <FileCode2 className="w-4 h-4 shrink-0" />
              <span className="truncate">Source Editor</span>
            </Link>
            <Link
              to="/dashboard/settings"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
            >
              <FolderGit2 className="w-4 h-4 shrink-0" />
              <span className="truncate">GitHub Integration</span>
            </Link>
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200 bg-white space-y-3 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{profile?.fullName}</p>
          <p className="text-xs text-slate-500 truncate">
            {profile?.email} · {profile?.role.replace('_', ' ')}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/"
            className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
          >
            Public Site
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
        <div className="pt-1">
          <PWAInstallButton compact />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="relative z-10 flex h-full">
            {sidebarContent}
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
              className="m-3 w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700 shadow-sm"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div
            className="fixed inset-0 bg-slate-900/30"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-4 sm:px-6 py-2.5 sm:py-0 sm:h-16 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0 flex-1 overflow-hidden">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={`${crumb.label}-${idx}`}>
                  {idx > 0 && <span className="text-slate-300 shrink-0">/</span>}
                  {crumb.to ? (
                    <Link
                      to={crumb.to}
                      className="text-slate-500 hover:text-slate-900 font-medium truncate"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-slate-900 font-semibold truncate">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </div>

          {action && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div>}
        </header>

        <main className="flex-1 bg-slate-50/50 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
