import React, { useCallback, useEffect, useState } from 'react';
import { Copy, FolderGit2, Mail, Send, Unlink } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type { EmailServiceStatus, GitHubStatus } from '../../types/index.ts';

export function SettingsPage() {
  const { organization, profile, isAdmin, refreshMe } = useAuth();

  const [orgName, setOrgName] = useState(organization?.name || '');
  const [brandLogoUrl, setBrandLogoUrl] = useState(organization?.brandLogoUrl || '');
  const [primaryColor, setPrimaryColor] = useState(organization?.primaryColor || '#0F172A');
  const [accentColor, setAccentColor] = useState(organization?.accentColor || '#1D4ED8');
  const [supportEmail, setSupportEmail] = useState(organization?.supportEmail || '');
  const [customDomain, setCustomDomain] = useState(organization?.customDomain || '');

  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [showTokenConnect, setShowTokenConnect] = useState(false);
  const [connectingToken, setConnectingToken] = useState(false);
  const [githubAuthFallbackUrl, setGithubAuthFallbackUrl] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<EmailServiceStatus | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState(profile?.email || '');
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadGitHubStatus = useCallback(async () => {
    try {
      const [status, mail] = await Promise.all([
        apiRequest<GitHubStatus>('/api/github/status?verify=1'),
        apiRequest<EmailServiceStatus>('/api/email/status'),
      ]);
      setGithubStatus(status);
      setEmailStatus(mail);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    loadGitHubStatus();
  }, [loadGitHubStatus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      if (event.data?.type === 'GITHUB_OAUTH_SUCCESS') {
        setMessage(`Connected GitHub account @${event.data.login}`);
        loadGitHubStatus();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [loadGitHubStatus]);

  const handleSaveBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBrand(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/api/organization', {
        method: 'PATCH',
        body: JSON.stringify({
          name: orgName,
          brandLogoUrl,
          primaryColor,
          accentColor,
          supportEmail,
          customDomain,
        }),
      });
      await refreshMe();
      setMessage('White-label organization settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding.');
    } finally {
      setSavingBrand(false);
    }
  };

  const handleConnectGitHub = async () => {
    setError(null);
    setMessage(null);
    setGithubAuthFallbackUrl(null);
    if (githubStatus && !githubStatus.configured) {
      setShowTokenConnect(true);
      setMessage('GitHub OAuth is not configured on this server. Generate and paste a Personal Access Token below to connect right away.');
      return;
    }
    try {
      const returnTo = encodeURIComponent(window.location.pathname);
      const { url } = await apiRequest<{ url: string }>(`/api/github/auth-url?returnTo=${returnTo}`);
      setGithubAuthFallbackUrl(url);
      setMessage('Tap "Open GitHub Authorization" below to connect in a new tab.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub OAuth is not configured.');
      setShowTokenConnect(true);
    }
  };

  const handleConnectGitHubToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubTokenInput.trim()) return;
    setConnectingToken(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ connected: boolean; githubLogin: string }>(
        '/api/github/connect-token',
        {
          method: 'POST',
          body: JSON.stringify({ token: githubTokenInput.trim() }),
        }
      );
      setGithubTokenInput('');
      setShowTokenConnect(false);
      setGithubAuthFallbackUrl(null);
      setMessage(`Connected GitHub account @${res.githubLogin}.`);
      await loadGitHubStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify GitHub token.');
    } finally {
      setConnectingToken(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    setError(null);
    try {
      await apiRequest('/api/github/disconnect', { method: 'DELETE' });
      await loadGitHubStatus();
      setMessage('GitHub account disconnected.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect GitHub.');
    }
  };

  const handleSendTestEmail = async () => {
    setTestingEmail(true);
    setError(null);
    setMessage(null);
    setTestEmailResult(null);
    try {
      const res = await apiRequest<{ sent: boolean; provider?: string; recipient?: string }>(
        '/api/email/test',
        {
          method: 'POST',
          body: JSON.stringify({ to: testEmailTo.trim() || undefined }),
        }
      );
      const okText = `Test email accepted by ${res.provider?.toUpperCase() || 'mailer'} for ${
        res.recipient || testEmailTo || profile?.email
      }. Check your inbox or Spam folder.`;
      setMessage(okText);
      setTestEmailResult({ ok: true, text: okText });
    } catch (err) {
      const errText = err instanceof Error ? err.message : 'Failed to send test email.';
      setError(errText);
      setTestEmailResult({ ok: false, text: errText });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone }),
      });
      await refreshMe();
      setMessage('Personal profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      await refreshMe();
      setMessage('Password updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Agency Console', to: '/dashboard' }, { label: 'Settings & Branding' }]}
    >
      <div className="space-y-8 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings, Branding &amp; GitHub</h1>
          <p className="text-sm text-slate-600 mt-1">
            Customize your white-label portal identity, connect GitHub OAuth, and manage your account security.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
        )}
        {message && (
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {/* White-Label Organization Branding */}
        {isAdmin && (
          <form onSubmit={handleSaveBrand} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <h2 className="text-base font-bold text-slate-900">White-Label Brand Identity</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Agency Display Name</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Support Email</label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="support@agency.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Brand Logo URL</label>
                <input
                  type="url"
                  value={brandLogoUrl}
                  onChange={(e) => setBrandLogoUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="https://cdn.agency.com/logo.png"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Custom Portal Domain</label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="portal.agency.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Primary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 rounded border border-slate-300"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Accent Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-9 w-12 rounded border border-slate-300"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingBrand}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
              >
                {savingBrand ? 'Saving...' : 'Save Branding'}
              </button>
            </div>
          </form>
        )}

        {/* GitHub OAuth Integration */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                <FolderGit2 className="w-5 h-5 text-slate-900" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">GitHub Integration</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Connect GitHub via server-side OAuth to sync repositories and deploy to GitHub Pages.
                </p>
              </div>
            </div>
            {githubStatus?.connected ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-emerald-700 font-semibold">
                  Connected: @{githubStatus.connection?.githubLogin}
                </span>
                <button
                  type="button"
                  onClick={handleDisconnectGitHub}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleConnectGitHub}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
                >
                  Connect GitHub Account
                </button>
                <button
                  type="button"
                  onClick={() => setShowTokenConnect((v) => !v)}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                >
                  {showTokenConnect ? 'Hide Token Option' : 'Use Personal Token'}
                </button>
              </div>
            )}
          </div>

          {githubAuthFallbackUrl && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
              <span>Authorize WebManager Pro in a new tab (works on mobile &amp; desktop):</span>
              <a
                href={githubAuthFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800"
              >
                Open GitHub Authorization
              </a>
            </div>
          )}

          {!githubStatus?.connected && showTokenConnect && (
            <form
              onSubmit={handleConnectGitHubToken}
              className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
            >
              <div className="text-xs text-slate-700 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">Connect with a GitHub Personal Access Token</p>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=WebManager+Pro"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
                  >
                    Generate Token on GitHub →
                  </a>
                </div>
                <p>
                  1. Tap <strong>Generate Token on GitHub</strong> above (it pre-selects the{' '}
                  <code className="font-mono">repo</code> scope). 2. Scroll down and tap{' '}
                  <strong>Generate token</strong>. 3. Copy the <code className="font-mono">ghp_...</code> token and paste it below:
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  required
                  value={githubTokenInput}
                  onChange={(e) => setGithubTokenInput(e.target.value)}
                  placeholder="ghp_... or github_pat_..."
                  className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  disabled={connectingToken}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                >
                  {connectingToken ? 'Verifying...' : 'Verify & Connect'}
                </button>
              </div>
            </form>
          )}

          {githubStatus && !githubStatus.configured && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 space-y-2 text-xs text-amber-900">
              <p className="font-semibold">GitHub OAuth Environment Setup Optional</p>
              <p>
                You can connect immediately using <strong>Use Personal Token</strong> above, or set{' '}
                <code className="font-mono">GITHUB_CLIENT_ID</code> and{' '}
                <code className="font-mono">GITHUB_CLIENT_SECRET</code> in runtime secrets with this callback URL:
              </p>
              <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded border border-amber-200">
                <code className="font-mono text-slate-800 truncate">{githubStatus.callbackUrl}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(githubStatus.callbackUrl)}
                  className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Transactional Email Delivery */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5 text-slate-900" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Automated Email Delivery</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Automatically email client, collaborator, and staff invitations, change request updates, and publish alerts.
                </p>
              </div>
            </div>
            {emailStatus?.configured ? (
              <span className="text-xs font-mono text-emerald-700 font-semibold">
                Active ({emailStatus.provider.toUpperCase()}
                {emailStatus.smtpHost ? ` · ${emailStatus.smtpHost}:${emailStatus.smtpPort}` : ''}
                {emailStatus.fromAddress ? ` · ${emailStatus.fromAddress}` : ''})
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-700">
                Not configured — manual invite links enabled
              </span>
            )}
          </div>

          {emailStatus?.configWarning && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              {emailStatus.configWarning}
            </div>
          )}

          {emailStatus?.configured && isAdmin && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
              <input
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="Recipient email for test..."
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                disabled={testingEmail}
                onClick={handleSendTestEmail}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{testingEmail ? 'Sending...' : 'Send Test Email'}</span>
              </button>
            </div>
          )}

          {testEmailResult && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                testEmailResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {testEmailResult.text}
            </div>
          )}

          {emailStatus && !emailStatus.configured && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">How to enable automated email delivery</p>
              <p>
                Add <code className="font-mono text-slate-900">RESEND_API_KEY</code> (recommended) or SMTP credentials (
                <code className="font-mono text-slate-900">SMTP_HOST</code>,{' '}
                <code className="font-mono text-slate-900">SMTP_PORT</code>,{' '}
                <code className="font-mono text-slate-900">SMTP_USER</code>,{' '}
                <code className="font-mono text-slate-900">SMTP_PASS</code>) plus{' '}
                <code className="font-mono text-slate-900">EMAIL_FROM</code> to your server environment variables. Until configured, invite links remain ready to copy in-app.
              </p>
            </div>
          )}
        </div>

        {/* User Profile & Security */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Your Profile</h2>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
            >
              {savingProfile ? 'Saving...' : 'Update Profile'}
            </button>
          </form>

          <form onSubmit={handleChangePassword} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Password Security</h2>
            {profile?.hasPassword && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Current Password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password (min. 8 characters)</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
            >
              {savingPassword ? 'Updating...' : 'Set Password'}
            </button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
