import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';

interface InviteInfo {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  organizationName: string;
  expiresAt: string;
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { authenticated, isAdminOrStaff, acceptInvite, loginWithGoogle } = useAuth();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authenticated) {
      navigate(isAdminOrStaff ? '/dashboard' : '/portal', { replace: true });
    }
  }, [authenticated, isAdminOrStaff, navigate]);

  useEffect(() => {
    async function load() {
      if (!token) return;
      try {
        const data = await apiRequest<InviteInfo>(`/api/invitations/${encodeURIComponent(token)}`);
        setInvite(data);
        setFullName(data.fullName);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invitation not found.');
      } finally {
        setLoadingInvite(false);
      }
    }
    load();
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      await acceptInvite({ token, fullName, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <div className="min-h-[calc(100vh-14rem)] bg-slate-50/70 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          {loadingInvite ? (
            <p className="text-sm text-slate-600">Validating invitation...</p>
          ) : !invite || invite.status !== 'pending' ? (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-slate-900">Invitation Unavailable</h1>
              <p className="text-sm text-slate-600">
                {error || `This invitation is ${invite?.status || 'invalid'} and cannot be used.`}
              </p>
              <Link
                to="/login"
                className="inline-block px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg"
              >
                Go to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium text-blue-700">{invite.organizationName}</p>
                <h1 className="text-2xl font-bold text-slate-900">Accept your workspace invite</h1>
                <p className="text-sm text-slate-600">
                  Invited as <strong className="text-slate-900">{invite.role.replace('_', ' ')}</strong> for{' '}
                  <span className="font-mono text-slate-900">{invite.email}</span>.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleAccept} className="space-y-4">
                <div>
                  <label htmlFor="inv-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="inv-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label htmlFor="inv-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Set Account Password (min. 8 characters)
                  </label>
                  <input
                    id="inv-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                    placeholder="Choose a password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  {busy ? 'Activating Account...' : 'Complete Onboarding'}
                </button>
              </form>

              <div className="pt-4 border-t border-slate-200 space-y-3">
                <p className="text-xs text-slate-500">
                  Prefer Google Sign-In? If your Google account uses {invite.email}, click below to accept automatically.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={loginWithGoogle}
                  className="w-full py-2 px-4 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100"
                >
                  Accept with Google ({invite.email})
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
