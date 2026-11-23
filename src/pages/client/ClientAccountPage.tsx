import React, { useState } from 'react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';

export function ClientAccountPage() {
  const { profile, organization, refreshMe } = useAuth();

  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone }),
      });
      await refreshMe();
      setNotice('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      await refreshMe();
      setNotice('Password updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setBusy(false);
    }
  };

  const handleContactAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/public/contact', {
        method: 'POST',
        body: JSON.stringify({
          fullName: profile?.fullName || fullName,
          email: profile?.email || '',
          company: organization?.name || 'Client Portal',
          subject: contactSubject,
          message: contactMessage,
        }),
      });
      setContactSubject('');
      setContactMessage('');
      setNotice('Message sent to your agency administrator.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Client Portal', to: '/portal' }, { label: 'Account & Security' }]}
    >
      <div className="space-y-8 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Account &amp; Support</h1>
          <p className="text-sm text-slate-600 mt-1">
            Update your personal details, change your password, or message your agency administrator.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Profile Details</h2>
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
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              Save Profile
            </button>
          </form>

          <form onSubmit={handleChangePassword} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Change Password</h2>
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
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              Update Password
            </button>
          </form>
        </div>

        <form onSubmit={handleContactAdmin} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            Contact {organization?.name || 'Agency Administrator'}
          </h2>
          {organization?.supportEmail && (
            <p className="text-xs text-slate-500">Direct support email: {organization.supportEmail}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
            <input
              type="text"
              required
              value={contactSubject}
              onChange={(e) => setContactSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              placeholder="Billing or account access question"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Message</label>
            <textarea
              required
              rows={3}
              value={contactMessage}
              onChange={(e) => setContactMessage(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              placeholder="Write your message to your agency manager..."
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            Send Message
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
