import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

export function RegisterPage() {
  const { authenticated, isAdminOrStaff, registerAgency, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authenticated) {
      navigate(isAdminOrStaff ? '/dashboard' : '/portal', { replace: true });
    }
  }, [authenticated, isAdminOrStaff, navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await registerAgency({ fullName, email, password, organizationName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create agency workspace.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-14rem)] bg-slate-50/70 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Create your agency workspace</h1>
            <p className="text-sm text-slate-600">
              Launch a white-label WebManager Pro organization for your clients and sites.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={handleGoogleSetup}
            className="w-full py-2.5 px-4 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            Quick Setup with Google Sign-In
          </button>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink mx-3 text-xs text-slate-400">or register with email</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label htmlFor="reg-org" className="block text-xs font-medium text-slate-700 mb-1.5">
                Agency / Organization Name
              </label>
              <input
                id="reg-org"
                type="text"
                required
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                placeholder="Northbridge Web Studio"
              />
            </div>
            <div>
              <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                Your Full Name
              </label>
              <input
                id="reg-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                placeholder="Jordan Blake"
              />
            </div>
            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                Admin Email
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                placeholder="jordan@northbridge.io"
              />
            </div>
            <div>
              <label htmlFor="reg-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                Password (min. 8 characters)
              </label>
              <input
                id="reg-password"
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                placeholder="Create a strong password"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? 'Creating Workspace...' : 'Create Agency Workspace'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
            <span>Already have an account?</span>
            <Link to="/login" className="font-semibold text-blue-700 hover:underline">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
