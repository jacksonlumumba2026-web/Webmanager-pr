import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { apiRequest } from '../../services/api.ts';
import type { InvitationRecord, StaffMemberRecord } from '../../types/index.ts';

interface StaffResponse {
  members: StaffMemberRecord[];
  invitations: InvitationRecord[];
}

export function StaffPage() {
  const [data, setData] = useState<StaffResponse>({ members: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteEmailNote, setInviteEmailNote] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'agency_admin'>('staff');
  const [sending, setSending] = useState(false);

  const loadStaff = useCallback(async () => {
    try {
      const res = await apiRequest<StaffResponse>('/api/staff');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await apiRequest<{ invitePath: string; emailSent?: boolean; emailNotice?: string }>(
        '/api/staff/invite',
        {
          method: 'POST',
          body: JSON.stringify({ fullName, email, role }),
        }
      );
      setInviteUrl(`${window.location.origin}${res.invitePath}`);
      setInviteEmailNote(
        res.emailSent
          ? `Invitation email sent automatically to ${email}.`
          : res.emailNotice || 'Email delivery not configured; copy and share the invite link below.'
      );
      setShowInvite(false);
      setFullName('');
      setEmail('');
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite staff member.');
    } finally {
      setSending(false);
    }
  };

  const handleTogglePermission = async (member: StaffMemberRecord, permKey: string) => {
    const nextPerms = {
      ...member.permissions,
      [permKey]: member.permissions[permKey] === false,
    };
    try {
      await apiRequest(`/api/staff/${member.memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: nextPerms }),
      });
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permissions.');
    }
  };

  const handleToggleStatus = async (member: StaffMemberRecord) => {
    const nextStatus = member.status === 'suspended' ? 'active' : 'suspended';
    try {
      await apiRequest(`/api/staff/${member.memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member status.');
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await apiRequest(`/api/invitations/${inviteId}`, { method: 'DELETE' });
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation.');
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Agency Console', to: '/dashboard' }, { label: 'Staff & Roles' }]}
      action={
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Invite Staff</span>
        </button>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Staff &amp; Role Permissions</h1>
          <p className="text-sm text-slate-600 mt-1">
            Invite agency administrators or staff members and manage server-enforced permissions.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
        )}

        {inviteUrl && (
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">Staff invitation link ready</p>
              <p className="text-xs font-mono text-emerald-800 truncate">{inviteUrl}</p>
              {inviteEmailNote && <p className="text-xs text-emerald-700 mt-1">{inviteEmailNote}</p>}
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(inviteUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-emerald-300 text-emerald-900 rounded-lg shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">Active Agency Team</h2>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading team members...</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Permissions</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.members.map((m) => (
                  <tr key={m.memberId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{m.fullName}</p>
                      <p className="text-xs text-slate-500">{m.email}</p>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700 capitalize">
                      {m.role.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-4">
                      {m.role === 'staff' ? (
                        <div className="flex flex-wrap gap-3 text-xs">
                          {[
                            { key: 'manageClients', label: 'Clients' },
                            { key: 'manageWebsites', label: 'Websites' },
                            { key: 'publishWebsites', label: 'Publish' },
                          ].map((perm) => (
                            <label key={perm.key} className="inline-flex items-center gap-1.5 text-slate-700">
                              <input
                                type="checkbox"
                                checked={m.permissions[perm.key] !== false}
                                onChange={() => handleTogglePermission(m, perm.key)}
                                className="rounded border-slate-300"
                              />
                              <span>{perm.label}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Full administrative access</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={m.status} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      {m.role !== 'super_admin' && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(m)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          {m.status === 'suspended' ? 'Reactivate' : 'Deactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">Invitations</h2>
          </div>
          {data.invitations.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No invitations issued yet.</p>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Invitee</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Expires</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{inv.fullName}</p>
                      <p className="text-xs text-slate-500">{inv.email}</p>
                    </td>
                    <td className="py-3 px-4 text-xs capitalize text-slate-700">
                      {inv.role.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={inv.status} />
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-500">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right space-x-3">
                      {inv.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`)
                            }
                            className="text-xs font-medium text-blue-700 hover:underline"
                          >
                            Copy Link
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeInvite(inv.id)}
                            className="text-xs font-medium text-red-700 hover:underline"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Invite Staff Member</h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowInvite(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Devon Patel"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="devon@agency.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'staff' | 'agency_admin')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="staff">Staff Member (Custom Permissions)</option>
                  <option value="agency_admin">Agency Administrator</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  {sending ? 'Sending...' : 'Create Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
