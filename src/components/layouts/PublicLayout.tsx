import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { PWAInstallButton } from '../common/PWAInstallButton.tsx';

const NAV_ITEMS = [
  { label: 'Home', to: '/' },
  { label: 'Features', to: '/features' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { authenticated, isAdminOrStaff } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const primaryActionPath = authenticated ? (isAdminOrStaff ? '/dashboard' : '/portal') : '/login';
  const primaryActionLabel = authenticated ? 'Open Console' : 'Client Login';

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-700"
          >
            WebManager Pro
          </Link>

          {/* Zone 2: 5 concise single-line text links */}
          <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                    active
                      ? 'text-slate-900 border-blue-700'
                      : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action + optional PWA install */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>
            <Link
              to={primaryActionPath}
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              {primaryActionLabel}
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-6 py-4 space-y-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className="block py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <Link
                to={primaryActionPath}
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                {primaryActionLabel}
              </Link>
              <div className="flex justify-center">
                <PWAInstallButton compact />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-2 space-y-3">
            <span className="text-base font-bold text-slate-900">WebManager Pro</span>
            <p className="text-sm text-slate-600 max-w-md leading-relaxed">
              White-label website operations platform for agencies managing client portals, source repositories, and production deployments from one workspace.
            </p>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-900">Platform</p>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="/features" className="hover:text-slate-900">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-slate-900">Pricing</Link></li>
              <li><Link to="/about" className="hover:text-slate-900">About</Link></li>
              <li><Link to="/contact" className="hover:text-slate-900">Contact</Link></li>
            </ul>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-900">Access</p>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="/login" className="hover:text-slate-900">Client Login</Link></li>
              <li><Link to="/register" className="hover:text-slate-900">Create Agency Workspace</Link></li>
              <li><Link to="/login" className="hover:text-slate-900">Staff Sign In</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} WebManager Pro. All rights reserved.</span>
            <span>White-label agency infrastructure · Multi-tenant PostgreSQL security</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
