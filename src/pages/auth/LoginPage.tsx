import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';

export function LoginPage() {
  const { authenticated, isAdminOrStaff, loginWithGoogle, loginWithPassword } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authenticated) {
      navigate(isAdminOrStaff ? '/dashboard' : '/portal', { replace: true });
    }
  }, [authenticated, isAdminOrStaff, navigate]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loginWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/request-reset', {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail }),
      });
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process reset request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-14rem)] bg-slate-50/70 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">
              {mode === 'signin' ? 'Sign in to WebManager Pro' : 'Reset your password'}
            </h1>
            <p className="text-sm text-slate-600">
              {mode === 'signin'
                ? 'Access your agency console or client website portal.'
                : 'Enter your account email to receive reset guidance.'}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
              {notice}
            </div>
          )}

          {mode === 'signin' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full py-2.5 px-4 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200" />
                <span className="shrink mx-3 text-xs text-slate-400">or sign in with email</span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email Address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                    placeholder="you@agency.com"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-xs font-medium text-slate-700">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setError(null);
                        setNotice(null);
                      }}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                    placeholder="Enter your password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors"
                >
                  {busy ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            </>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Account Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  placeholder="you@company.com"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'Submitting...' : 'Request Reset'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setNotice(null);
                }}
                className="w-full text-center text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Back to sign in
              </button>
            </form>
          )}

          <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
            <span>New agency?</span>
            <Link to="/register" className="font-semibold text-blue-700 hover:underline">
              Create Agency Workspace
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
