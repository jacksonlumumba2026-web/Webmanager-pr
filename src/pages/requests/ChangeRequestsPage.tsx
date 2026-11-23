import React, { useCallback, useEffect, useState } from 'react';
import { Download, Eye, FileText, Image as ImageIcon, Paperclip, Plus, X } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type {
  ChangeRequestAttachment,
  ChangeRequestRecord,
  WebsiteRecord,
} from '../../types/index.ts';

interface PendingAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function ChangeRequestsPage() {
  const { isAdminOrStaff, getAuthToken } = useAuth();
  const [requests, setRequests] = useState<ChangeRequestRecord[]>([]);
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [websiteId, setWebsiteId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [responseStatus, setResponseStatus] = useState('in_progress');

  const [previewModal, setPreviewModal] = useState<{
    name: string;
    objectUrl: string;
  } | null>(null);
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [reqData, siteData] = await Promise.all([
        apiRequest<ChangeRequestRecord[]>('/api/change-requests'),
        apiRequest<WebsiteRecord[]>('/api/websites'),
      ]);
      setRequests(reqData);
      setWebsites(siteData);
      if (siteData.length > 0) {
        setWebsiteId((prev) => prev || siteData[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load change requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      if (previewModal?.objectUrl) {
        URL.revokeObjectURL(previewModal.objectUrl);
      }
    };
  }, [previewModal]);

  const handleSelectFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    setError(null);
    if (pendingAttachments.length + fileList.length > MAX_ATTACHMENTS) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files per request.`);
      return;
    }

    const added: PendingAttachment[] = [];
    for (const file of fileList) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name}" exceeds the 3 MB per-file limit.`);
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        added.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          dataUrl,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not read ${file.name}.`);
        return;
      }
    }
    setPendingAttachments((prev) => [...prev, ...added]);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/api/change-requests', {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          title,
          description,
          priority,
          attachments: pendingAttachments,
        }),
      });
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setPendingAttachments([]);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit change request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeResponseId) return;
    setError(null);
    try {
      await apiRequest(`/api/change-requests/${activeResponseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: responseStatus, adminResponse: responseText }),
      });
      setActiveResponseId(null);
      setResponseText('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update change request.');
    }
  };

  const handleOpenAttachment = async (
    requestId: string,
    attachment: ChangeRequestAttachment,
    mode: 'preview' | 'download'
  ) => {
    setLoadingAttachmentId(attachment.id);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(
        `/api/change-requests/${requestId}/attachments/${attachment.id}${mode === 'preview' ? '?inline=1' : ''}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (!res.ok) {
        throw new Error('Could not load attachment.');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (mode === 'preview' && attachment.isImage) {
        if (previewModal?.objectUrl) {
          URL.revokeObjectURL(previewModal.objectUrl);
        }
        setPreviewModal({ name: attachment.name, objectUrl });
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attachment.');
    } finally {
      setLoadingAttachmentId(null);
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[
        {
          label: isAdminOrStaff ? 'Agency Console' : 'Client Portal',
          to: isAdminOrStaff ? '/dashboard' : '/portal',
        },
        { label: 'Change Requests' },
      ]}
      action={
        websites.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Change Request</span>
          </button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Website Change Requests</h1>
          <p className="text-sm text-slate-600 mt-1">
            {isAdminOrStaff
              ? 'Review, prioritize, and respond to client website update requests and reference assets.'
              : 'Submit content, design, or feature update requests and attach logos, screenshots, or briefs.'}
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading change requests...</p>
          ) : requests.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600">No change requests submitted yet.</p>
              {websites.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                >
                  Submit First Request
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {requests.map((reqItem) => (
                <div key={reqItem.id} className="p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-base font-bold text-slate-900">{reqItem.title}</h2>
                        <StatusText status={reqItem.status} />
                      </div>
                      <p className="text-xs text-slate-500">
                        {reqItem.websiteName || 'Website'}{' '}
                        {reqItem.clientBusiness ? `· ${reqItem.clientBusiness}` : ''} · Priority:{' '}
                        <span className="capitalize font-medium text-slate-700">
                          {reqItem.priority}
                        </span>{' '}
                        ·{' '}
                        <span className="font-mono tabular-nums">
                          {new Date(reqItem.createdAt).toLocaleString()}
                        </span>
                      </p>
                    </div>

                    {isAdminOrStaff && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveResponseId(reqItem.id);
                          setResponseStatus(reqItem.status);
                          setResponseText(reqItem.adminResponse || '');
                        }}
                        className="text-xs font-semibold text-blue-700 hover:underline self-start sm:self-center"
                      >
                        Update &amp; Respond
                      </button>
                    )}
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {reqItem.description}
                  </p>

                  {reqItem.attachments && reqItem.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {reqItem.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700"
                        >
                          {att.isImage ? (
                            <ImageIcon className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                          <span className="font-medium truncate max-w-[180px]">{att.name}</span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {formatBytes(att.sizeBytes)}
                          </span>
                          {att.isImage && (
                            <button
                              type="button"
                              disabled={loadingAttachmentId === att.id}
                              onClick={() => handleOpenAttachment(reqItem.id, att, 'preview')}
                              className="inline-flex items-center gap-1 text-blue-700 hover:underline font-semibold ml-1 disabled:opacity-50"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Preview</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={loadingAttachmentId === att.id}
                            onClick={() => handleOpenAttachment(reqItem.id, att, 'download')}
                            aria-label={`Download ${att.name}`}
                            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-medium disabled:opacity-50"
                          >
                            <Download className="w-3 h-3" />
                            <span>Save</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {reqItem.adminResponse && (
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">Agency Response: </span>
                      {reqItem.adminResponse}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Submit Change Request</h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowCreate(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitRequest} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Website</label>
                  <select
                    required
                    value={websiteId}
                    onChange={(e) => setWebsiteId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {websites.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Request Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Update homepage Q4 pricing table"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Details</label>
                <textarea
                  required
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Describe the exact text, layout, or feature changes needed..."
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700">
                    Attachments (optional, up to {MAX_ATTACHMENTS} files · max 3 MB each)
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>Add Images / Files</span>
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.csv,.doc,.docx,.zip"
                      onChange={handleSelectFiles}
                      className="hidden"
                    />
                  </label>
                </div>
                {pendingAttachments.length > 0 && (
                  <div className="space-y-1.5">
                    {pendingAttachments.map((att, idx) => (
                      <div
                        key={`${att.name}-${idx}`}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                      >
                        <span className="truncate font-medium text-slate-800">
                          {att.name}{' '}
                          <span className="text-slate-400 font-mono">
                            ({formatBytes(att.sizeBytes)})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={`Remove ${att.name}`}
                          className="text-slate-400 hover:text-red-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeResponseId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Update Change Request</h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setActiveResponseId(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAdminUpdate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={responseStatus}
                  onChange={(e) => setResponseStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="open">Open</option>
                  <option value="in_review">In Review</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Response to Client
                </label>
                <textarea
                  rows={3}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Share status or deployment notes with the client..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveResponseId(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Save Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
              <p className="text-sm font-bold text-slate-900 truncate">{previewModal.name}</p>
              <button
                type="button"
                aria-label="Close image preview"
                onClick={() => {
                  URL.revokeObjectURL(previewModal.objectUrl);
                  setPreviewModal(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center max-h-[75vh] overflow-auto">
              <img
                src={previewModal.objectUrl}
                alt={previewModal.name}
                className="max-w-full max-h-[68vh] rounded border border-slate-200 object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
