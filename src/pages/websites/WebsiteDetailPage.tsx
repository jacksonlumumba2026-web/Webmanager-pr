import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));
import {
  Activity,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileCode2,
  FilePlus2,
  Folder,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Monitor,
  Pencil,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { ApiError, apiRequest } from '../../services/api.ts';
import {
  inferMimeType,
  isBinaryImageFile,
  isDataUrlPayload,
  isKnownBinaryExtension,
} from '../../services/fileValidation.ts';
import type {
  ClientRecord,
  DeploymentConfigRecord,
  DeploymentRecord,
  GitHubRepoSummary,
  GitHubStatus,
  InvitationRecord,
  UptimeCheckRecord,
  WebsiteCollaboratorRecord,
  WebsiteFileRecord,
  WebsiteRecord,
  WebsiteRepositoryRecord,
} from '../../types/index.ts';

interface WebsiteDetailResponse {
  website: WebsiteRecord;
  canEditFiles: boolean;
  canInviteCollaborators: boolean;
  accessLevel: 'agency' | 'owner' | 'editor' | 'viewer';
  client: ClientRecord | null;
  repository: WebsiteRepositoryRecord | null;
  deploymentConfig: DeploymentConfigRecord | null;
  deployments: DeploymentRecord[];
  collaborators: WebsiteCollaboratorRecord[];
  collaboratorInvites: InvitationRecord[];
}

function resolveWorkspaceAssetPath(baseFilePath: string, rawRef: string): string | null {
  const cleanRef = rawRef.split('#')[0].split('?')[0].trim();
  if (!cleanRef || /^(https?:|data:|blob:|mailto:|tel:|\/\/)/i.test(cleanRef)) {
    return null;
  }
  const baseParts = cleanRef.startsWith('/')
    ? []
    : baseFilePath.split('/').slice(0, -1);
  for (const part of cleanRef.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(decodeURIComponent(part));
    }
  }
  return baseParts.join('/').toLowerCase();
}

function getAssetDataUrl(
  baseFilePath: string,
  rawRef: string,
  fileMap: Map<string, string>
): string | null {
  const resolved = resolveWorkspaceAssetPath(baseFilePath, rawRef);
  if (!resolved) return null;
  const raw = fileMap.get(resolved);
  if (raw === undefined) return null;
  if (raw.startsWith('data:')) return raw;
  if (resolved.endsWith('.svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  }
  return null;
}

function rewriteCssAssetUrls(
  css: string,
  cssFilePath: string,
  fileMap: Map<string, string>
): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, quote: string, refPath: string) => {
    const dataUrl = getAssetDataUrl(cssFilePath, refPath, fileMap);
    return dataUrl ? `url(${quote || '"'}${dataUrl}${quote || '"'})` : full;
  });
}

function buildDraftPreviewHtml(
  files: WebsiteFileRecord[],
  draftContents: Record<string, string>,
  selectedFile: WebsiteFileRecord | null
): string {
  const fileMap = new Map<string, string>();
  for (const f of files) {
    if (!f.isDirectory) {
      fileMap.set(f.path.toLowerCase(), draftContents[f.id] ?? f.content);
    }
  }

  const targetHtmlFile =
    selectedFile &&
    !selectedFile.isDirectory &&
    (selectedFile.name.toLowerCase().endsWith('.html') || selectedFile.name.toLowerCase().endsWith('.htm'))
      ? selectedFile
      : files.find((f) => !f.isDirectory && f.path.toLowerCase() === 'index.html') ||
        files.find(
          (f) => !f.isDirectory && (f.name.toLowerCase().endsWith('.html') || f.name.toLowerCase().endsWith('.htm'))
        );

  if (!targetHtmlFile) {
    return '<!doctype html><html><body style="font-family:system-ui;padding:32px;color:#475569"><h3>No HTML Entry File</h3><p>Create or upload an <code>index.html</code> file to preview this website live.</p></body></html>';
  }

  let html = draftContents[targetHtmlFile.id] ?? targetHtmlFile.content;

  // Inline local <link rel="stylesheet" href="..."> and rewrite CSS url(...) assets
  html = html.replace(
    /<link\b[^>]*href=["']([^"'?#]+\.css(?:[?#][^"']*)?)["'][^>]*>/gi,
    (match, relPath: string) => {
      if (!/stylesheet/i.test(match)) return match;
      const resolved = resolveWorkspaceAssetPath(targetHtmlFile.path, relPath);
      if (!resolved) return match;
      const css = fileMap.get(resolved);
      if (css === undefined) return match;
      return `<style>\n${rewriteCssAssetUrls(css, resolved, fileMap)}\n</style>`;
    }
  );

  // Inline local <script src="..."> from workspace draft files
  html = html.replace(
    /<script\b[^>]*src=["']([^"'?#]+\.(?:js|mjs)(?:[?#][^"']*)?)["'][^>]*>\s*<\/script>/gi,
    (match, relPath: string) => {
      const resolved = resolveWorkspaceAssetPath(targetHtmlFile.path, relPath);
      if (!resolved) return match;
      const js = fileMap.get(resolved);
      return js !== undefined ? `<script>\n${js}\n</script>` : match;
    }
  );

  // Inline local images & icons in <img src="...">, <source src="...">, <link href="...">, <video poster="...">
  html = html.replace(
    /(<(?:img|source|link|video)\b[^>]*?\s(?:src|href|poster)=)(["'])([^"']+)\2/gi,
    (full, prefix: string, quote: string, refPath: string) => {
      const dataUrl = getAssetDataUrl(targetHtmlFile.path, refPath, fileMap);
      return dataUrl ? `${prefix}${quote}${dataUrl}${quote}` : full;
    }
  );

  // Rewrite srcset="img1.png 1x, img2.png 2x"
  html = html.replace(
    /(<(?:img|source)\b[^>]*?\ssrcset=)(["'])([^"']+)\2/gi,
    (full, prefix: string, quote: string, srcsetVal: string) => {
      const rewritten = srcsetVal
        .split(',')
        .map((candidate) => {
          const trimmed = candidate.trim();
          if (!trimmed) return trimmed;
          const parts = trimmed.split(/\s+/);
          const dataUrl = getAssetDataUrl(targetHtmlFile.path, parts[0], fileMap);
          if (!dataUrl) return trimmed;
          return [dataUrl, ...parts.slice(1)].join(' ');
        })
        .join(', ');
      return `${prefix}${quote}${rewritten}${quote}`;
    }
  );

  html = rewriteCssAssetUrls(html, targetHtmlFile.path, fileMap);

  return html;
}

async function readUploadedFilePayload(file: File): Promise<string> {
  const readAsDataUrl = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        if (result.startsWith('data:;base64,')) {
          const mime = inferMimeType(file.name);
          resolve(`data:${mime};base64,${result.slice('data:;base64,'.length)}`);
        } else {
          resolve(result);
        }
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsDataURL(file);
    });

  if (isKnownBinaryExtension(file.name)) {
    return readAsDataUrl();
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.includes(0)) {
    return readAsDataUrl();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return readAsDataUrl();
  }
}

function detectMonacoLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'dockerfile';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.scss') || lower.endsWith('.sass')) return 'scss';
  if (lower.endsWith('.less')) return 'less';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.jsx')) {
    return 'javascript';
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.py') || lower.endsWith('.pyw') || lower.endsWith('.pyi')) return 'python';
  if (lower.endsWith('.json') || lower.endsWith('.ipynb')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.php')) return 'php';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
  if (lower.endsWith('.ps1')) return 'powershell';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.rb')) return 'ruby';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
  if (lower.endsWith('.swift')) return 'swift';
  if (lower.endsWith('.dart')) return 'dart';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
  if (lower.endsWith('.cpp') || lower.endsWith('.hpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) {
    return 'cpp';
  }
  if (lower.endsWith('.graphql') || lower.endsWith('.gql')) return 'graphql';
  if (lower.endsWith('.xml') || lower.endsWith('.svg')) return 'xml';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.ini') || lower.endsWith('.toml') || lower.endsWith('.cfg') || lower.endsWith('.conf') || lower === '.env' || lower.endsWith('.env')) {
    return 'ini';
  }
  return 'plaintext';
}

export function WebsiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, isAdminOrStaff, getAuthToken } = useAuth();

  const [activeTab, setActiveTab] = useState<'overview' | 'editor' | 'github' | 'publishing' | 'access'>(
    'overview'
  );
  const [detail, setDetail] = useState<WebsiteDetailResponse | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [files, setFiles] = useState<WebsiteFileRecord[]>([]);
  const [canEditFiles, setCanEditFiles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Overview edit & Uptime state
  const [siteName, setSiteName] = useState('');
  const [siteDomain, setSiteDomain] = useState('');
  const [siteLiveUrl, setSiteLiveUrl] = useState('');
  const [siteStatus, setSiteStatus] = useState('pending');
  const [siteClientId, setSiteClientId] = useState('');
  const [siteDescription, setSiteDescription] = useState('');
  const [savingOverview, setSavingOverview] = useState(false);
  const [uptimeTargetUrl, setUptimeTargetUrl] = useState<string | null>(null);
  const [uptimeChecks, setUptimeChecks] = useState<UptimeCheckRecord[]>([]);
  const [checkingUptime, setCheckingUptime] = useState(false);

  // File manager, ZIP import, & Live Preview state
  const [fileSearch, setFileSearch] = useState('');
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [draftContents, setDraftContents] = useState<Record<string, string>>({});
  const [savingFile, setSavingFile] = useState(false);
  const [newItemMode, setNewItemMode] = useState<'file' | 'folder' | null>(null);
  const [newItemPath, setNewItemPath] = useState('');
  const [renamingFile, setRenamingFile] = useState<WebsiteFileRecord | null>(null);
  const [renameTargetPath, setRenameTargetPath] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [importingFiles, setImportingFiles] = useState(false);
  const [showUrlImportModal, setShowUrlImportModal] = useState(false);
  const [importUrlInput, setImportUrlInput] = useState('');
  const [importMaxPages, setImportMaxPages] = useState<number>(10);
  const [importIncludeExternal, setImportIncludeExternal] = useState(true);
  const [urlImporting, setUrlImporting] = useState(false);
  const [urlImportError, setUrlImportError] = useState<string | null>(null);
  const [urlImportSummary, setUrlImportSummary] = useState<{
    importedCount: number;
    pagesImported: number;
    assetsImported: number;
    detectedStack: string[];
    finalEntryUrl: string;
    skipped: string[];
  } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);

  // GitHub state
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [ghRepos, setGhRepos] = useState<GitHubRepoSummary[]>([]);
  const [ownershipMode, setOwnershipMode] = useState<'agency_managed' | 'client_owned'>('agency_managed');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghTokenInput, setGhTokenInput] = useState('');
  const [showGhTokenForm, setShowGhTokenForm] = useState(false);
  const [ghAuthFallbackUrl, setGhAuthFallbackUrl] = useState<string | null>(null);

  // Publishing, Rollback & Domain DNS state
  const [pubProvider, setPubProvider] = useState<'managed_hosting' | 'github_pages' | 'custom_domain' | 'other'>(
    'managed_hosting'
  );
  const [pubBranch, setPubBranch] = useState('main');
  const [pubCustomDomain, setPubCustomDomain] = useState('');
  const [pubAutoDeploy, setPubAutoDeploy] = useState(false);
  const [notifyClientOnPublish, setNotifyClientOnPublish] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [confirmRollbackId, setConfirmRollbackId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [verifyingDns, setVerifyingDns] = useState(false);
  const [dnsCheckResult, setDnsCheckResult] = useState<{
    verified: boolean;
    hostname: string;
    targetHost: string;
    cnameRecords: string[];
    aRecords: string[];
    message: string;
  } | null>(null);

  // Collaborators & Client Permissions state
  const [clientCanEdit, setClientCanEdit] = useState(false);
  const [clientCanInviteCollaborators, setClientCanInviteCollaborators] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);
  const [collabName, setCollabName] = useState('');
  const [collabEmail, setCollabEmail] = useState('');
  const [collabLevel, setCollabLevel] = useState<'viewer' | 'editor' | 'owner'>('viewer');
  const [invitingCollab, setInvitingCollab] = useState(false);
  const [collabInviteBanner, setCollabInviteBanner] = useState<{
    url: string;
    emailSent: boolean;
    emailNotice?: string;
  } | null>(null);

  const loadWebsite = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const siteRes = await apiRequest<WebsiteDetailResponse>(`/api/websites/${id}`);

      setDetail(siteRes);
      setCanEditFiles(siteRes.canEditFiles);
      setSiteName(siteRes.website.name);
      setSiteDomain(siteRes.website.domain || '');
      setSiteLiveUrl(siteRes.website.liveUrl || '');
      setSiteStatus(siteRes.website.status);
      setSiteClientId(siteRes.website.clientId || '');
      setSiteDescription(siteRes.website.description || '');
      setClientCanEdit(Boolean(siteRes.website.clientCanEdit));
      setClientCanInviteCollaborators(Boolean(siteRes.website.clientCanInviteCollaborators));

      if (siteRes.repository) {
        setOwnershipMode(siteRes.repository.ownershipMode);
        setRepoOwner(siteRes.repository.repoOwner);
        setRepoName(siteRes.repository.repoName);
        setDefaultBranch(siteRes.repository.defaultBranch);
      }
      if (siteRes.deploymentConfig) {
        setPubProvider(siteRes.deploymentConfig.provider);
        setPubBranch(siteRes.deploymentConfig.branch);
        setPubCustomDomain(siteRes.deploymentConfig.customDomain || '');
        setPubAutoDeploy(siteRes.deploymentConfig.autoDeploy);
      } else if (
        siteRes.website.hostingProvider === 'managed_hosting' ||
        siteRes.website.hostingProvider === 'github_pages' ||
        siteRes.website.hostingProvider === 'custom_domain' ||
        siteRes.website.hostingProvider === 'other'
      ) {
        setPubProvider(siteRes.website.hostingProvider);
      }

      // Render workspace immediately once primary site detail is ready
      setLoading(false);

      // Load secondary workspace data non-blockingly so slow/failing sub-calls never freeze the page
      setFilesLoading(true);
      const [filesSettled, githubSettled, uptimeSettled, clientsSettled] = await Promise.allSettled([
        apiRequest<{ canEditFiles: boolean; files: WebsiteFileRecord[] }>(`/api/websites/${id}/files`),
        apiRequest<GitHubStatus>('/api/github/status'),
        apiRequest<{ targetUrl: string | null; latest: UptimeCheckRecord | null; checks: UptimeCheckRecord[] }>(
          `/api/websites/${id}/uptime`
        ),
        isAdminOrStaff ? apiRequest<ClientRecord[]>('/api/clients') : Promise.resolve([] as ClientRecord[]),
      ]);

      if (filesSettled.status === 'fulfilled') {
        const filesRes = filesSettled.value;
        setCanEditFiles(filesRes.canEditFiles);
        setFiles(filesRes.files);
        const firstCodeFile = filesRes.files.find((f) => !f.isDirectory);
        if (firstCodeFile) {
          setOpenFileIds((prev) => (prev.length > 0 ? prev : [firstCodeFile.id]));
          setSelectedFileId((prev) => prev || firstCodeFile.id);
        }
      }
      setFilesLoading(false);

      if (githubSettled.status === 'fulfilled') {
        setGhStatus(githubSettled.value);
      }
      if (uptimeSettled.status === 'fulfilled') {
        setUptimeTargetUrl(uptimeSettled.value.targetUrl);
        setUptimeChecks(uptimeSettled.value.checks);
      }
      if (clientsSettled.status === 'fulfilled' && isAdminOrStaff) {
        setClients(clientsSettled.value);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load website workspace.');
      setLoading(false);
      setFilesLoading(false);
    }
  }, [id, isAdminOrStaff]);

  useEffect(() => {
    loadWebsite();
  }, [loadWebsite]);

  const handleRunUptimeCheck = async () => {
    if (!id) return;
    setCheckingUptime(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ check: UptimeCheckRecord; website: WebsiteRecord }>(
        `/api/websites/${id}/uptime/check`,
        { method: 'POST' }
      );
      setNotice(
        res.check.isUp
          ? `Site is online (${res.check.httpStatus ?? 200}, ${res.check.responseTimeMs ?? 0}ms).`
          : `Site appears offline (${res.check.errorMessage || `HTTP ${res.check.httpStatus ?? 'error'}`}).`
      );
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uptime check failed.');
    } finally {
      setCheckingUptime(false);
    }
  };

  useEffect(() => {
    const handleMsg = (event: MessageEvent) => {
      if (!event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) return;
      if (event.data?.type === 'GITHUB_OAUTH_SUCCESS') {
        setNotice(`Connected GitHub account @${event.data.login}`);
        loadWebsite();
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [loadWebsite]);

  const selectedFile = useMemo(
    () => files.find((f) => f.id === selectedFileId) || null,
    [files, selectedFileId]
  );

  const openTabs = useMemo(
    () => openFileIds.map((fid) => files.find((f) => f.id === fid)).filter(Boolean) as WebsiteFileRecord[],
    [openFileIds, files]
  );

  const activeContent = selectedFile
    ? draftContents[selectedFile.id] ?? selectedFile.content
    : '';

  const isSelectedDirty = selectedFile
    ? draftContents[selectedFile.id] !== undefined && draftContents[selectedFile.id] !== selectedFile.content
    : false;

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return files
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.path.localeCompare(b.path);
      });
  }, [files, fileSearch]);

  const handleOpenFile = (file: WebsiteFileRecord) => {
    if (file.isDirectory) return;
    setOpenFileIds((prev) => (prev.includes(file.id) ? prev : [...prev, file.id]));
    setSelectedFileId(file.id);
  };

  const handleCloseTab = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = openFileIds.filter((fid) => fid !== fileId);
    setOpenFileIds(next);
    if (selectedFileId === fileId) {
      setSelectedFileId(next[next.length - 1] || null);
    }
  };

  const handleSaveFile = useCallback(async () => {
    if (!id || !selectedFile || !canEditFiles) return;
    setSavingFile(true);
    setError(null);
    try {
      const contentToSave = draftContents[selectedFile.id] ?? selectedFile.content;
      const updated = await apiRequest<WebsiteFileRecord>(
        `/api/websites/${id}/files/${selectedFile.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: contentToSave }),
        }
      );
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setDraftContents((prev) => {
        const copy = { ...prev };
        delete copy[selectedFile.id];
        return copy;
      });
      setNotice(`Saved draft changes to ${updated.path} (not yet published).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file.');
    } finally {
      setSavingFile(false);
    }
  }, [id, selectedFile, canEditFiles, draftContents]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && activeTab === 'editor') {
        e.preventDefault();
        handleSaveFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, handleSaveFile]);

  const handleCreateFileOrFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !newItemMode || !newItemPath.trim()) return;
    setError(null);
    try {
      const created = await apiRequest<WebsiteFileRecord>(`/api/websites/${id}/files`, {
        method: 'POST',
        body: JSON.stringify({
          path: newItemPath.trim(),
          isDirectory: newItemMode === 'folder',
          content: '',
        }),
      });
      setFiles((prev) => [...prev, created]);
      if (!created.isDirectory) {
        setOpenFileIds((prev) => [...prev, created.id]);
        setSelectedFileId(created.id);
      }
      setNewItemMode(null);
      setNewItemPath('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create item.');
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !renamingFile || !renameTargetPath.trim()) return;
    setError(null);
    try {
      const updated = await apiRequest<WebsiteFileRecord>(
        `/api/websites/${id}/files/${renamingFile.id}/rename`,
        {
          method: 'PATCH',
          body: JSON.stringify({ newPath: renameTargetPath.trim() }),
        }
      );
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setRenamingFile(null);
      setRenameTargetPath('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename file.');
    }
  };

  const handleDeleteFile = async (file: WebsiteFileRecord) => {
    if (!id) return;
    setError(null);
    try {
      await apiRequest(`/api/websites/${id}/files/${file.id}`, { method: 'DELETE' });
      setFiles((prev) => prev.filter((f) => f.id !== file.id && !f.path.startsWith(`${file.path}/`)));
      setOpenFileIds((prev) => prev.filter((fid) => fid !== file.id));
      if (selectedFileId === file.id) setSelectedFileId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file.');
    }
  };

  const handleUploadZipFile = async (zipFile: File) => {
    if (!id) return;
    setImportingFiles(true);
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read ZIP file.'));
        reader.readAsDataURL(zipFile);
      });
      const res = await apiRequest<{ importedCount: number; skipped: string[] }>(
        `/api/websites/${id}/files/import-zip`,
        {
          method: 'POST',
          body: JSON.stringify({ filename: zipFile.name, base64: dataUrl }),
        }
      );
      const skipMsg = res.skipped.length > 0 ? ` (${res.skipped.length} unsupported/skipped)` : '';
      setNotice(`Imported ${res.importedCount} file(s) from ${zipFile.name}${skipMsg}.`);
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ZIP import failed.');
    } finally {
      setImportingFiles(false);
    }
  };

  const handleBatchUploadFiles = async (fileList: FileList) => {
    if (!id || fileList.length === 0) return;
    setImportingFiles(true);
    setError(null);
    setNotice(null);
    try {
      let uploadedCount = 0;
      const errors: string[] = [];
      for (const file of Array.from(fileList)) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          await handleUploadZipFile(file);
          continue;
        }
        try {
          const filePayload = await readUploadedFilePayload(file);

          const created = await apiRequest<WebsiteFileRecord>(`/api/websites/${id}/files`, {
            method: 'POST',
            body: JSON.stringify({
              path: file.name,
              isDirectory: false,
              content: filePayload,
              overwrite: true,
            }),
          });
          setFiles((prev) =>
            prev.some((f) => f.id === created.id)
              ? prev.map((f) => (f.id === created.id ? created : f))
              : [...prev, created]
          );
          setOpenFileIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
          setSelectedFileId(created.id);
          uploadedCount++;
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      if (uploadedCount > 0) {
        setNotice(`Uploaded ${uploadedCount} file(s).${errors.length > 0 ? ` Skipped: ${errors.join('; ')}` : ''}`);
      } else if (errors.length > 0) {
        setError(errors.join('; '));
      }
    } finally {
      setImportingFiles(false);
    }
  };

  const handleReplaceSelectedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!id || !selectedFile || !file) return;
    setSavingFile(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await readUploadedFilePayload(file);
      const updated = await apiRequest<WebsiteFileRecord>(
        `/api/websites/${id}/files/${selectedFile.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: payload }),
        }
      );
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setDraftContents((prev) => {
        const copy = { ...prev };
        delete copy[selectedFile.id];
        return copy;
      });
      setNotice(`Replaced ${updated.path}. Click Live Preview to verify or Publish Now when ready.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace file.');
    } finally {
      setSavingFile(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await handleBatchUploadFiles(e.target.files);
    e.target.value = '';
  };

  const handleZipSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleUploadZipFile(file);
    }
    e.target.value = '';
  };

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFiles(false);
    if (!canEditFiles || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    await handleBatchUploadFiles(e.dataTransfer.files);
  };

  const handleOpenUrlImport = () => {
    const defaultUrl =
      detail?.website.liveUrl ||
      (detail?.website.domain ? `https://${detail.website.domain}` : '');
    setImportUrlInput(defaultUrl);
    setUrlImportError(null);
    setUrlImportSummary(null);
    setShowUrlImportModal(true);
  };

  const handleImportFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !importUrlInput.trim()) return;
    setUrlImporting(true);
    setUrlImportError(null);
    setError(null);
    setNotice(null);
    setUrlImportSummary(null);
    try {
      const res = await apiRequest<{
        importedCount: number;
        pagesImported: number;
        assetsImported: number;
        detectedStack: string[];
        finalEntryUrl: string;
        skipped: string[];
      }>(`/api/websites/${id}/files/import-url`, {
        method: 'POST',
        body: JSON.stringify({
          url: importUrlInput.trim(),
          maxPages: importMaxPages,
          includeExternalAssets: importIncludeExternal,
        }),
      });
      setUrlImportSummary(res);
      setNotice(
        `Imported ${res.importedCount} files (${res.pagesImported} pages, ${res.assetsImported} assets) from ${res.finalEntryUrl}.`
      );
      await loadWebsite();
    } catch (err) {
      setUrlImportError(err instanceof Error ? err.message : 'Failed to import website from URL.');
    } finally {
      setUrlImporting(false);
    }
  };

  const handleDownloadFile = async (file: WebsiteFileRecord) => {
    if (!id) return;
    const token = await getAuthToken();
    const res = await fetch(`/api/websites/${id}/files/${file.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportZip = async () => {
    if (!id) return;
    setError(null);
    setNotice(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/websites/${id}/files/export-zip`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to export website ZIP.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug =
        (detail?.website.name || 'website')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'website';
      a.download = `${slug}-source.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice('Website source archive (.zip) downloaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ZIP export failed.');
    }
  };

  const handleSaveOverview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingOverview(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/websites/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: siteName,
          domain: siteDomain,
          liveUrl: siteLiveUrl,
          status: siteStatus,
          clientId: siteClientId || null,
          description: siteDescription,
        }),
      });
      setNotice('Website settings saved.');
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update website.');
    } finally {
      setSavingOverview(false);
    }
  };

  const handleConnectGitHub = async () => {
    setError(null);
    setNotice(null);
    setGhAuthFallbackUrl(null);
    if (ghStatus && !ghStatus.configured) {
      setShowGhTokenForm(true);
      setNotice('GitHub OAuth is not configured on this server. Generate and paste a Personal Access Token below to connect right away.');
      return;
    }
    try {
      const returnTo = encodeURIComponent(window.location.pathname);
      const { url } = await apiRequest<{ url: string }>(`/api/github/auth-url?returnTo=${returnTo}`);
      setGhAuthFallbackUrl(url);
      setNotice('Tap "Open GitHub Authorization" below to authorize in a new tab.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start GitHub authorization.');
      setShowGhTokenForm(true);
    }
  };

  const handleConnectGitHubToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghTokenInput.trim()) return;
    setGhBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ connected: boolean; githubLogin: string }>(
        '/api/github/connect-token',
        {
          method: 'POST',
          body: JSON.stringify({ token: ghTokenInput.trim() }),
        }
      );
      setGhTokenInput('');
      setShowGhTokenForm(false);
      setGhAuthFallbackUrl(null);
      setNotice(`Connected GitHub account @${res.githubLogin}.`);
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify GitHub token.');
    } finally {
      setGhBusy(false);
    }
  };

  const handleLoadGitHubRepos = async () => {
    setGhBusy(true);
    setError(null);
    try {
      const repos = await apiRequest<GitHubRepoSummary[]>('/api/github/repos');
      setGhRepos(repos);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setGhRepos([]);
        await loadWebsite();
      }
      setError(err instanceof Error ? err.message : 'Failed to load GitHub repositories.');
    } finally {
      setGhBusy(false);
    }
  };

  const handleLinkRepo = async (createNewRepo = false) => {
    if (!id) return;
    setGhBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/websites/${id}/repository`, {
        method: 'POST',
        body: JSON.stringify({
          ownershipMode,
          repoOwner,
          repoName,
          defaultBranch,
          createNewRepo,
        }),
      });
      setNotice('GitHub repository linked to website.');
      await loadWebsite();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await loadWebsite();
      }
      setError(err instanceof Error ? err.message : 'Failed to link repository.');
    } finally {
      setGhBusy(false);
    }
  };

  const handlePullFromGitHub = async () => {
    if (!id) return;
    setGhBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ importedCount: number; commitSha: string }>(
        `/api/websites/${id}/repository/pull`,
        { method: 'POST' }
      );
      setNotice(`Pulled ${res.importedCount} files from GitHub (${res.commitSha.slice(0, 7)}).`);
      await loadWebsite();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await loadWebsite();
      }
      setError(err instanceof Error ? err.message : 'Pull failed.');
    } finally {
      setGhBusy(false);
    }
  };

  const handleCommitToGitHub = async () => {
    if (!id) return;
    setGhBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ commitSha: string; committedFiles: number }>(
        `/api/websites/${id}/repository/commit`,
        {
          method: 'POST',
          body: JSON.stringify({ message: commitMessage }),
        }
      );
      setCommitMessage('');
      setNotice(`Committed ${res.committedFiles} files to GitHub (${res.commitSha.slice(0, 7)}).`);
      await loadWebsite();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await loadWebsite();
      }
      setError(err instanceof Error ? err.message : 'Commit failed.');
    } finally {
      setGhBusy(false);
    }
  };

  const handleSaveDeploymentConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/websites/${id}/deployment-config`, {
        method: 'PUT',
        body: JSON.stringify({
          provider: pubProvider,
          branch: pubBranch,
          customDomain: pubCustomDomain,
          autoDeploy: pubAutoDeploy,
        }),
      });
      setNotice('Deployment configuration saved.');
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save deployment config.');
    }
  };

  const handlePublish = async () => {
    if (!id) return;
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ deployment: DeploymentRecord }>(`/api/websites/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          provider: pubProvider,
          branch: pubBranch,
          customDomain: pubCustomDomain,
          autoDeploy: pubAutoDeploy,
          notifyClient: notifyClientOnPublish,
        }),
      });
      setNotice(`Published successfully to ${res.deployment.liveUrl}`);
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed.');
      await loadWebsite();
    } finally {
      setPublishing(false);
    }
  };

  const handleRollback = async (deploymentId: string) => {
    if (!id) return;
    setRollingBackId(deploymentId);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ deployment: DeploymentRecord }>(
        `/api/websites/${id}/deployments/${deploymentId}/rollback`,
        { method: 'POST' }
      );
      setConfirmRollbackId(null);
      setNotice(`Rolled back live site to snapshot (${res.deployment.snapshotFileCount || 0} files restored).`);
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed.');
    } finally {
      setRollingBackId(null);
    }
  };

  const handleVerifyDomain = async () => {
    if (!id) return;
    setVerifyingDns(true);
    setError(null);
    try {
      const res = await apiRequest<{
        verified: boolean;
        hostname: string;
        targetHost: string;
        cnameRecords: string[];
        aRecords: string[];
        message: string;
      }>(`/api/websites/${id}/verify-domain`, {
        method: 'POST',
        body: JSON.stringify({ domain: pubCustomDomain || siteDomain }),
      });
      setDnsCheckResult(res);
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Domain verification failed.');
    } finally {
      setVerifyingDns(false);
    }
  };

  const handleSaveClientPermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingPerms(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/websites/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          clientCanEdit,
          clientCanInviteCollaborators,
        }),
      });
      setNotice('Client & collaborator permissions updated.');
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permissions.');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleInviteCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setInvitingCollab(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        mode: 'added' | 'invited';
        invitePath: string | null;
        emailSent: boolean;
        emailNotice?: string;
      }>(`/api/websites/${id}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: collabName,
          email: collabEmail,
          accessLevel: collabLevel,
        }),
      });
      setCollabName('');
      setCollabEmail('');
      if (res.mode === 'added') {
        setNotice('Existing workspace user granted access to this website.');
        setCollabInviteBanner(null);
      } else if (res.invitePath) {
        setCollabInviteBanner({
          url: `${window.location.origin}${res.invitePath}`,
          emailSent: res.emailSent,
          emailNotice: res.emailNotice,
        });
      }
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite collaborator.');
    } finally {
      setInvitingCollab(false);
    }
  };

  const handleUpdateCollaboratorRole = async (memberId: string, accessLevel: string) => {
    if (!id) return;
    setError(null);
    try {
      await apiRequest(`/api/websites/${id}/collaborators/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ accessLevel }),
      });
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update collaborator role.');
    }
  };

  const handleRemoveCollaborator = async (memberId: string) => {
    if (!id) return;
    setError(null);
    try {
      await apiRequest(`/api/websites/${id}/collaborators/${memberId}`, { method: 'DELETE' });
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove collaborator.');
    }
  };

  const handleRevokeCollaboratorInvite = async (inviteId: string) => {
    setError(null);
    try {
      await apiRequest(`/api/invitations/${inviteId}`, { method: 'DELETE' });
      await loadWebsite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation.');
    }
  };

  const draftPreviewHtml = useMemo(
    () => (showPreview ? buildDraftPreviewHtml(files, draftContents, selectedFile) : ''),
    [showPreview, files, draftContents, selectedFile]
  );

  const unpublishedCount = files.filter((f) => f.hasUnpublishedChanges).length;
  const visibleTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'editor', label: 'Source & Files' },
    ...(isAdminOrStaff || detail?.canInviteCollaborators
      ? [{ id: 'access', label: 'Access & Team' }]
      : []),
    { id: 'github', label: 'GitHub' },
    { id: 'publishing', label: 'Publishing' },
  ];

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: isAdminOrStaff ? 'Agency Console' : 'Client Portal', to: isAdminOrStaff ? '/dashboard' : '/portal' },
        { label: isAdminOrStaff ? 'Websites' : 'My Websites', to: isAdminOrStaff ? '/dashboard/websites' : '/portal' },
        { label: detail?.website.name || 'Website' },
      ]}
      action={
        detail?.website.liveUrl ? (
          <a
            href={detail.website.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <span>Open Live Site</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-slate-600 py-8">
          <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
          <span>Loading website workspace...</span>
        </div>
      ) : !detail ? (
        <div className="p-6 rounded-xl bg-white border border-slate-200 max-w-md space-y-3">
          <p className="text-sm font-semibold text-red-700">{error || 'Website not found.'}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadWebsite();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Loading Workspace</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header & Tab Navigation */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900">{detail.website.name}</h1>
                <StatusText status={detail.website.status} />
              </div>
              <p className="text-xs text-slate-500">
                {detail.client ? detail.client.businessName : 'Internal Agency Site'} ·{' '}
                {detail.website.domain || 'No custom domain'} ·{' '}
                <span className="font-mono tabular-nums">
                  {unpublishedCount > 0
                    ? `${unpublishedCount} unpublished draft file(s)`
                    : 'All saved files synced with latest publish'}
                </span>
                {!isAdminOrStaff && (
                  <span> · Access: {canEditFiles ? 'Editor' : 'Viewer (Read-only)'}</span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit overflow-x-auto">
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as typeof activeTab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                    activeTab === t.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 break-words">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 break-words">
              {notice}
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-slate-900">Website Details</h2>
                {isAdminOrStaff ? (
                  <form onSubmit={handleSaveOverview} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Website Name</label>
                        <input
                          type="text"
                          required
                          value={siteName}
                          onChange={(e) => setSiteName(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Client</label>
                        <select
                          value={siteClientId}
                          onChange={(e) => setSiteClientId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="">Unassigned</option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.businessName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Domain</label>
                        <input
                          type="text"
                          value={siteDomain}
                          onChange={(e) => setSiteDomain(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                        <select
                          value={siteStatus}
                          onChange={(e) => setSiteStatus(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="active">Active</option>
                          <option value="pending">Pending</option>
                          <option value="attention">Needs Attention</option>
                          <option value="archived">Archived</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Live Website URL</label>
                      <input
                        type="url"
                        value={siteLiveUrl}
                        onChange={(e) => setSiteLiveUrl(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Notes &amp; Description</label>
                      <textarea
                        rows={3}
                        value={siteDescription}
                        onChange={(e) => setSiteDescription(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingOverview}
                        className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                      >
                        {savingOverview ? 'Saving...' : 'Save Website Info'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Domain</dt>
                      <dd className="font-mono text-slate-900 mt-0.5">{detail.website.domain || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Hosting Provider</dt>
                      <dd className="text-slate-900 mt-0.5 capitalize">
                        {detail.website.hostingProvider === 'managed_hosting'
                          ? 'WebManager Hosted'
                          : detail.website.hostingProvider.replace('_', ' ')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Last Published</dt>
                      <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                        {detail.website.lastPublishedAt
                          ? new Date(detail.website.lastPublishedAt).toLocaleString()
                          : 'Not yet published'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Created</dt>
                      <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                        {new Date(detail.website.createdAt).toLocaleDateString()}
                      </dd>
                    </div>
                    {detail.website.description && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">Description</dt>
                        <dd className="text-slate-700 mt-0.5">{detail.website.description}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>

              <div className="lg:col-span-5 space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-slate-500" />
                      <h3 className="text-sm font-bold text-slate-900">Uptime &amp; SSL Monitor</h3>
                    </div>
                    <button
                      type="button"
                      disabled={checkingUptime || !uptimeTargetUrl}
                      onClick={handleRunUptimeCheck}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${checkingUptime ? 'animate-spin' : ''}`} />
                      <span>{checkingUptime ? 'Checking...' : 'Check Now'}</span>
                    </button>
                  </div>
                  {!uptimeTargetUrl ? (
                    <p className="text-xs text-slate-500">
                      Publish this site or configure a public domain/live URL to enable uptime &amp; SSL checks.
                    </p>
                  ) : (
                    <div className="text-xs space-y-2 text-slate-600">
                      <div className="flex justify-between items-center">
                        <span>Status</span>
                        {detail.website.lastUptimeStatus ? (
                          <StatusText status={detail.website.lastUptimeStatus} />
                        ) : (
                          <span className="text-slate-500">Not checked yet</span>
                        )}
                      </div>
                      <div className="flex justify-between">
                        <span>Response time</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {detail.website.lastResponseTimeMs != null
                            ? `${detail.website.lastResponseTimeMs} ms`
                            : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                          <span>SSL Certificate</span>
                        </span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {uptimeChecks[0]?.sslDaysRemaining != null
                            ? `${uptimeChecks[0].sslValid ? 'Valid' : 'Warning'} · ${uptimeChecks[0].sslDaysRemaining}d left`
                            : detail.website.sslExpiresAt
                              ? `Expires ${new Date(detail.website.sslExpiresAt).toLocaleDateString()}`
                              : '—'}
                        </span>
                      </div>
                      {uptimeChecks[0]?.sslIssuer && (
                        <div className="flex justify-between">
                          <span>Issuer</span>
                          <span className="text-slate-800 truncate max-w-[180px]">
                            {uptimeChecks[0].sslIssuer}
                          </span>
                        </div>
                      )}
                      {uptimeChecks.length > 0 && (
                        <div className="pt-2 mt-2 border-t border-slate-100 space-y-1">
                          <p className="text-[11px] font-semibold text-slate-500">Recent Checks</p>
                          {uptimeChecks.slice(0, 4).map((chk) => (
                            <div
                              key={chk.id}
                              className="flex items-center justify-between text-[11px] font-mono tabular-nums"
                            >
                              <span className={chk.isUp ? 'text-emerald-700' : 'text-red-700'}>
                                {chk.isUp ? `UP (${chk.httpStatus ?? 200})` : `DOWN (${chk.errorMessage || chk.httpStatus || 'ERR'})`}
                              </span>
                              <span className="text-slate-500">
                                {chk.responseTimeMs != null ? `${chk.responseTimeMs}ms · ` : ''}
                                {new Date(chk.checkedAt).toLocaleTimeString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Source &amp; Repository Status</h3>
                  <div className="text-sm space-y-2 text-slate-600">
                    <div className="flex justify-between">
                      <span>Tracked files</span>
                      <span className="font-mono tabular-nums text-slate-900">
                        {files.filter((f) => !f.isDirectory).length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Unpublished draft files</span>
                      <span className="font-mono tabular-nums text-slate-900">{unpublishedCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Linked repository</span>
                      <span className="font-mono text-slate-900 truncate max-w-[200px]">
                        {detail.repository
                          ? `${detail.repository.repoOwner}/${detail.repository.repoName}`
                          : 'Not linked'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Recent Deployments</h3>
                  {detail.deployments.length === 0 ? (
                    <p className="text-xs text-slate-500">No deployments recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {detail.deployments.slice(0, 5).map((dep) => (
                        <div key={dep.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                          <span className="font-mono tabular-nums text-slate-600">
                            {new Date(dep.createdAt).toLocaleString()}
                          </span>
                          <StatusText status={dep.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SOURCE CODE & MONACO EDITOR */}
          {activeTab === 'editor' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[620px]">
              {/* File Explorer with Drag-and-Drop & ZIP Import */}
              <div
                onDragOver={(e) => {
                  if (!canEditFiles) return;
                  e.preventDefault();
                  setIsDraggingFiles(true);
                }}
                onDragLeave={() => setIsDraggingFiles(false)}
                onDrop={handleDropFiles}
                className={`lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col transition-colors ${
                  isDraggingFiles ? 'bg-blue-50/70' : 'bg-slate-50/50'
                }`}
              >
                <div className="p-3 border-b border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {importingFiles ? 'Importing...' : 'Files & Assets'}
                    </span>
                    <button
                      type="button"
                      onClick={handleExportZip}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 whitespace-nowrap"
                    >
                      <Download className="w-3 h-3" />
                      <span>Export .zip</span>
                    </button>
                  </div>
                  {canEditFiles && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => zipInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 whitespace-nowrap"
                      >
                        <FileArchive className="w-3.5 h-3.5" />
                        <span>Upload .zip</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenUrlImport}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Import URL</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 whitespace-nowrap"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Files</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewItemMode('file');
                          setNewItemPath('');
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 whitespace-nowrap"
                      >
                        <FilePlus2 className="w-3.5 h-3.5" />
                        <span>+ File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewItemMode('folder');
                          setNewItemPath('');
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 whitespace-nowrap"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>+ Folder</span>
                      </button>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        multiple
                        onChange={handleUploadFile}
                        className="hidden"
                      />
                      <input
                        ref={zipInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        onChange={handleZipSelect}
                        className="hidden"
                      />
                    </div>
                  )}
                  {canEditFiles && (
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Supports any file type — HTML, CSS, JS/TS, Python (<span className="font-mono">.py</span>), configs, images, fonts, PDFs, and{' '}
                      <span className="font-mono">.zip</span> archives. Drag &amp; drop files here to upload.
                    </p>
                  )}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      placeholder="Filter files..."
                      className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                </div>

                {newItemMode && (
                  <form onSubmit={handleCreateFileOrFolder} className="p-2.5 border-b border-slate-200 bg-white space-y-2">
                    <input
                      type="text"
                      autoFocus
                      required
                      value={newItemPath}
                      onChange={(e) => setNewItemPath(e.target.value)}
                      placeholder={newItemMode === 'folder' ? 'src/components' : 'app.py or index.html'}
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setNewItemMode(null)}
                        className="text-xs text-slate-600 px-2 py-1"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="text-xs font-semibold text-white bg-slate-900 px-2.5 py-1 rounded"
                      >
                        Create
                      </button>
                    </div>
                  </form>
                )}

                {renamingFile && (
                  <form onSubmit={handleRenameSubmit} className="p-2.5 border-b border-slate-200 bg-white space-y-2">
                    <p className="text-xs text-slate-600 truncate">Rename {renamingFile.path}</p>
                    <input
                      type="text"
                      autoFocus
                      required
                      value={renameTargetPath}
                      onChange={(e) => setRenameTargetPath(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRenamingFile(null)}
                        className="text-xs text-slate-600 px-2 py-1"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="text-xs font-semibold text-white bg-slate-900 px-2.5 py-1 rounded"
                      >
                        Rename
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {filteredFiles.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">No files in this website yet.</p>
                  ) : (
                    filteredFiles.map((file) => {
                      const active = selectedFileId === file.id;
                      const dirty =
                        draftContents[file.id] !== undefined && draftContents[file.id] !== file.content;
                      return (
                        <div
                          key={file.id}
                          onClick={() => handleOpenFile(file)}
                          className={`px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer group ${
                            active ? 'bg-blue-50 text-blue-900 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {file.isDirectory ? (
                              <Folder className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            ) : isBinaryImageFile(file.name) ? (
                              <ImageIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            ) : (
                              <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            )}
                            <span className="font-mono truncate">{file.path}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {dirty ? (
                              <span className="text-[11px] text-amber-700 font-sans">Unsaved</span>
                            ) : file.hasUnpublishedChanges ? (
                              <span className="text-[11px] text-blue-700 font-sans">Draft</span>
                            ) : null}
                            {!file.isDirectory && (
                              <button
                                type="button"
                                title="Download file"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownloadFile(file);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-900"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                            )}
                            {canEditFiles && (
                              <>
                                <button
                                  type="button"
                                  title="Rename"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingFile(file);
                                    setRenameTargetPath(file.path);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-900"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteFile(file);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-700"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Monaco Code Editor + Live Draft Preview */}
              <div className="lg:col-span-8 xl:col-span-9 flex flex-col">
                <div className="h-11 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2 px-2">
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {openTabs.map((tab) => {
                      const isActive = tab.id === selectedFileId;
                      return (
                        <div
                          key={tab.id}
                          onClick={() => setSelectedFileId(tab.id)}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-md cursor-pointer whitespace-nowrap ${
                            isActive
                              ? 'bg-white text-slate-900 border border-slate-200 font-semibold'
                              : 'text-slate-600 hover:bg-slate-200/60'
                          }`}
                        >
                          <span>{tab.name}</span>
                          <button
                            type="button"
                            aria-label={`Close ${tab.name}`}
                            onClick={(e) => handleCloseTab(tab.id, e)}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {showPreview && (
                      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5">
                        <button
                          type="button"
                          title="Desktop Preview"
                          onClick={() => setPreviewViewport('desktop')}
                          className={`p-1 rounded ${
                            previewViewport === 'desktop' ? 'bg-slate-900 text-white' : 'text-slate-600'
                          }`}
                        >
                          <Monitor className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Mobile Preview"
                          onClick={() => setPreviewViewport('mobile')}
                          className={`p-1 rounded ${
                            previewViewport === 'mobile' ? 'bg-slate-900 text-white' : 'text-slate-600'
                          }`}
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPreview((p) => !p)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border whitespace-nowrap ${
                        showPreview
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{showPreview ? 'Hide Preview' : 'Live Preview'}</span>
                    </button>
                    {selectedFile &&
                      canEditFiles &&
                      !isBinaryImageFile(selectedFile.name) &&
                      !isDataUrlPayload(activeContent) && (
                      <button
                        type="button"
                        disabled={savingFile || !isSelectedDirty}
                        onClick={handleSaveFile}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingFile ? 'Saving...' : 'Save Draft'}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className={`flex-1 min-h-[540px] grid ${showPreview ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                  <div className={showPreview ? 'border-b xl:border-b-0 xl:border-r border-slate-200' : ''}>
                    {selectedFile ? (
                      isBinaryImageFile(selectedFile.name) || activeContent.startsWith('data:image/') ? (
                        <div className="h-[560px] bg-slate-50 p-6 flex flex-col items-center justify-center gap-4">
                          <div className="max-w-full max-h-[380px] bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-center overflow-hidden">
                            <img
                              src={activeContent}
                              alt={selectedFile.path}
                              className="max-w-full max-h-[340px] object-contain"
                            />
                          </div>
                          <div className="text-center space-y-2">
                            <p className="text-xs font-mono font-semibold text-slate-900">
                              {selectedFile.path}
                            </p>
                            <p className="text-xs text-slate-500 font-mono tabular-nums">
                              {selectedFile.mimeType} · {(selectedFile.sizeBytes / 1024).toFixed(1)} KB
                            </p>
                            <div className="flex items-center justify-center gap-2 pt-1">
                              {canEditFiles && (
                                <button
                                  type="button"
                                  disabled={savingFile}
                                  onClick={() => replaceFileInputRef.current?.click()}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                                >
                                  <Upload className="w-3.5 h-3.5" />
                                  <span>{savingFile ? 'Replacing...' : 'Replace Image'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDownloadFile(selectedFile)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download</span>
                              </button>
                            </div>
                          </div>
                          <input
                            ref={replaceFileInputRef}
                            type="file"
                            onChange={handleReplaceSelectedFile}
                            className="hidden"
                          />
                        </div>
                      ) : isDataUrlPayload(activeContent) ? (
                        <div className="h-[560px] bg-slate-50 p-6 flex flex-col items-center justify-center gap-4">
                          {selectedFile.name.toLowerCase().endsWith('.pdf') && (
                            <iframe
                              title={selectedFile.path}
                              src={activeContent}
                              className="w-full h-[360px] bg-white border border-slate-200 rounded-lg"
                            />
                          )}
                          <div className="text-center space-y-2">
                            <p className="text-xs font-mono font-semibold text-slate-900">
                              {selectedFile.path}
                            </p>
                            <p className="text-xs text-slate-500 font-mono tabular-nums">
                              Binary Asset ({selectedFile.mimeType}) · {(selectedFile.sizeBytes / 1024).toFixed(1)} KB
                            </p>
                            <div className="flex items-center justify-center gap-2 pt-1">
                              {canEditFiles && (
                                <button
                                  type="button"
                                  disabled={savingFile}
                                  onClick={() => replaceFileInputRef.current?.click()}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                                >
                                  <Upload className="w-3.5 h-3.5" />
                                  <span>{savingFile ? 'Replacing...' : 'Replace File'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDownloadFile(selectedFile)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download File</span>
                              </button>
                            </div>
                          </div>
                          <input
                            ref={replaceFileInputRef}
                            type="file"
                            onChange={handleReplaceSelectedFile}
                            className="hidden"
                          />
                        </div>
                      ) : (
                        <Suspense
                          fallback={
                            <div className="h-[560px] flex items-center justify-center text-sm text-slate-500">
                              Loading code editor...
                            </div>
                          }
                        >
                          <MonacoEditor
                            height="560px"
                            language={detectMonacoLanguage(selectedFile.name)}
                            value={activeContent}
                            onChange={(val) => {
                              if (!canEditFiles || val === undefined) return;
                              setDraftContents((prev) => ({ ...prev, [selectedFile.id]: val }));
                            }}
                            options={{
                              readOnly: !canEditFiles,
                              minimap: { enabled: false },
                              fontSize: 13,
                              fontFamily: "'JetBrains Mono', monospace",
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              automaticLayout: true,
                            }}
                          />
                        </Suspense>
                      )
                    ) : (
                      <div className="h-full flex items-center justify-center p-8 text-sm text-slate-500">
                        {filesLoading
                          ? 'Loading workspace files...'
                          : 'Select a file from the explorer to view or edit source code.'}
                      </div>
                    )}
                  </div>

                  {showPreview && (
                    <div className="bg-slate-100 p-4 flex flex-col items-center justify-start overflow-auto min-h-[400px]">
                      <div
                        className={`bg-white border border-slate-200 rounded-lg overflow-hidden h-[520px] transition-all ${
                          previewViewport === 'mobile' ? 'w-[375px] max-w-full' : 'w-full'
                        }`}
                      >
                        <iframe
                          title="Draft Website Preview"
                          sandbox="allow-scripts allow-forms"
                          srcDoc={draftPreviewHtml}
                          className="w-full h-full border-0"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: ACCESS & COLLABORATORS */}
          {activeTab === 'access' && (isAdminOrStaff || detail.canInviteCollaborators) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 space-y-6">
                {isAdminOrStaff && (
                  <form
                    onSubmit={handleSaveClientPermissions}
                    className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <Users className="w-5 h-5 text-slate-900" />
                      <h2 className="text-base font-bold text-slate-900">Client Portal Permissions</h2>
                    </div>
                    <p className="text-xs text-slate-600">
                      Control whether the assigned client can edit source files directly or invite their own
                      collaborators to this website.
                    </p>
                    <label className="flex items-start gap-2.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={clientCanEdit}
                        onChange={(e) => setClientCanEdit(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span>
                        <strong className="block font-medium text-slate-900">Allow Client to Edit Files</strong>
                        <span className="text-xs text-slate-500">
                          Grants Monaco editor, file upload, and ZIP import access for this website.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={clientCanInviteCollaborators}
                        onChange={(e) => setClientCanInviteCollaborators(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span>
                        <strong className="block font-medium text-slate-900">
                          Allow Client to Assign Team Collaborators
                        </strong>
                        <span className="text-xs text-slate-500">
                          Lets the primary client invite additional viewers or editors for this site.
                        </span>
                      </span>
                    </label>
                    <button
                      type="submit"
                      disabled={savingPerms}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                    >
                      {savingPerms ? 'Saving...' : 'Save Client Permissions'}
                    </button>
                  </form>
                )}

                <form
                  onSubmit={handleInviteCollaborator}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <h2 className="text-base font-bold text-slate-900">Invite Website Collaborator</h2>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={collabName}
                      onChange={(e) => setCollabName(e.target.value)}
                      placeholder="Alex Mwangi"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={collabEmail}
                      onChange={(e) => setCollabEmail(e.target.value)}
                      placeholder="alex@clientcompany.com"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Website Access Level</label>
                    <select
                      value={collabLevel}
                      onChange={(e) => setCollabLevel(e.target.value as 'viewer' | 'editor' | 'owner')}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="viewer">Viewer (Read-only &amp; Change Requests)</option>
                      {(isAdminOrStaff || detail.website.clientCanEdit) && (
                        <option value="editor">Editor (Edit Source Files &amp; Upload)</option>
                      )}
                      {isAdminOrStaff && <option value="owner">Co-Owner (Can Manage Collaborators)</option>}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={invitingCollab}
                    className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    {invitingCollab ? 'Generating Invite...' : 'Add or Invite Collaborator'}
                  </button>

                  {collabInviteBanner && (
                    <div className="p-3.5 rounded-lg border border-blue-200 bg-blue-50 space-y-2 text-xs">
                      <p className="font-semibold text-blue-900">
                        {collabInviteBanner.emailSent
                          ? 'Invitation sent via email and ready to share:'
                          : 'Share this onboarding link with the collaborator:'}
                      </p>
                      <p className="font-mono text-blue-800 break-all">{collabInviteBanner.url}</p>
                      {!collabInviteBanner.emailSent && collabInviteBanner.emailNotice && (
                        <p className="text-blue-700">{collabInviteBanner.emailNotice}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(collabInviteBanner.url)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-blue-300 text-blue-900 rounded-md font-semibold"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Invite Link</span>
                      </button>
                    </div>
                  )}
                </form>
              </div>

              <div className="lg:col-span-7 space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h2 className="text-base font-bold text-slate-900">Active Website Collaborators</h2>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      {detail.collaborators.length}
                    </span>
                  </div>
                  {detail.collaborators.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">
                      No additional collaborators assigned yet. The primary assigned client still retains
                      access according to Client Portal Permissions.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {detail.collaborators.map((m) => (
                        <div key={m.id} className="px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{m.fullName}</p>
                            <p className="text-xs text-slate-500 font-mono truncate">{m.email}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <select
                              value={m.accessLevel}
                              onChange={(e) => handleUpdateCollaboratorRole(m.id, e.target.value)}
                              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                            >
                              <option value="viewer">Viewer</option>
                              {(isAdminOrStaff || detail.website.clientCanEdit) && (
                                <option value="editor">Editor</option>
                              )}
                              {isAdminOrStaff && <option value="owner">Owner</option>}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRemoveCollaborator(m.id)}
                              className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {detail.collaboratorInvites.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-200">
                      <h2 className="text-sm font-bold text-slate-900">Pending Collaborator Invitations</h2>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {detail.collaboratorInvites.map((inv) => {
                        const fullUrl = `${window.location.origin}/invite/${inv.token}`;
                        return (
                          <div key={inv.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900">{inv.fullName}</p>
                              <p className="text-xs text-slate-500 font-mono">
                                {inv.email} · {inv.websiteAccessLevel || 'viewer'}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(fullUrl)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy Link</span>
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleRevokeCollaboratorInvite(inv.id)}
                                  className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: GITHUB INTEGRATION */}
          {activeTab === 'github' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <FolderGit2 className="w-5 h-5 text-slate-900" />
                    <h2 className="text-base font-bold text-slate-900">Repository Connection</h2>
                  </div>
                  {ghStatus?.connected ? (
                    <span className="text-xs font-mono text-emerald-700 font-semibold">
                      @{ghStatus.connection?.githubLogin}
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleConnectGitHub}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
                      >
                        Connect GitHub
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowGhTokenForm((v) => !v)}
                        className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                      >
                        {showGhTokenForm ? 'Hide Token' : 'Use Token'}
                      </button>
                    </div>
                  )}
                </div>

                {ghAuthFallbackUrl && (
                  <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
                    <span>Authorize WebManager Pro in a new tab:</span>
                    <a
                      href={ghAuthFallbackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800"
                    >
                      Open GitHub Authorization
                    </a>
                  </div>
                )}

                {!ghStatus?.connected && showGhTokenForm && (
                  <form
                    onSubmit={handleConnectGitHubToken}
                    className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-700">
                        Paste a GitHub Personal Access Token (<code className="font-mono">repo</code> scope):
                      </p>
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo&description=WebManager+Pro"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
                      >
                        Generate Token on GitHub →
                      </a>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="password"
                        required
                        value={ghTokenInput}
                        onChange={(e) => setGhTokenInput(e.target.value)}
                        placeholder="ghp_... or github_pat_..."
                        className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={ghBusy}
                        className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                      >
                        {ghBusy ? 'Verifying...' : 'Verify & Connect'}
                      </button>
                    </div>
                  </form>
                )}

                {ghStatus && !ghStatus.configured && (
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
                    <p className="font-semibold">GitHub OAuth credentials not configured</p>
                    <p>
                      You can use <strong>Use Token</strong> above right away, or add{' '}
                      <code className="font-mono">GITHUB_CLIENT_ID</code> and{' '}
                      <code className="font-mono">GITHUB_CLIENT_SECRET</code> with callback URL:{' '}
                      <code className="font-mono break-all">{ghStatus.callbackUrl}</code>
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Repository Workflow</label>
                    <select
                      value={ownershipMode}
                      disabled={!isAdminOrStaff}
                      onChange={(e) =>
                        setOwnershipMode(e.target.value as 'agency_managed' | 'client_owned')
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="agency_managed">Workflow A: Agency-Managed Repository</option>
                      <option value="client_owned">Workflow B: Client-Owned Repository</option>
                    </select>
                  </div>

                  {ghStatus?.connected && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={ghBusy}
                        onClick={handleLoadGitHubRepos}
                        className="text-xs font-semibold text-blue-700 hover:underline"
                      >
                        Browse my GitHub repositories
                      </button>
                      {ghRepos.length > 0 && (
                        <select
                          onChange={(e) => {
                            const found = ghRepos.find((r) => r.fullName === e.target.value);
                            if (found) {
                              setRepoOwner(found.owner);
                              setRepoName(found.name);
                              setDefaultBranch(found.defaultBranch);
                            }
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Select a GitHub repository...
                          </option>
                          {ghRepos.map((r) => (
                            <option key={r.id} value={r.fullName}>
                              {r.fullName} ({r.defaultBranch})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Owner / Org</label>
                      <input
                        type="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={repoOwner}
                        onChange={(e) => setRepoOwner(e.target.value)}
                        placeholder="agency-org"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Repository Name</label>
                      <input
                        type="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        placeholder="client-site"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Default Branch</label>
                      <input
                        type="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={defaultBranch}
                        onChange={(e) => setDefaultBranch(e.target.value)}
                        placeholder="main"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={ghBusy}
                      onClick={() => handleLinkRepo(false)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                    >
                      Save Repository Link
                    </button>
                    {ghStatus?.connected && isAdminOrStaff && (
                      <button
                        type="button"
                        disabled={ghBusy}
                        onClick={() => handleLinkRepo(true)}
                        className="px-4 py-2 text-xs font-semibold text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                      >
                        Create New Repo on GitHub
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <h2 className="text-base font-bold text-slate-900">Source Sync &amp; Commits</h2>
                {detail.repository ? (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                      <p className="font-mono font-semibold text-slate-900">
                        {detail.repository.repoOwner}/{detail.repository.repoName}
                      </p>
                      <p className="text-slate-600 flex items-center gap-1.5">
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>Branch: {detail.repository.defaultBranch}</span>
                        {detail.repository.lastCommitSha && (
                          <span className="font-mono">· {detail.repository.lastCommitSha.slice(0, 7)}</span>
                        )}
                      </p>
                    </div>

                    {canEditFiles && (
                      <>
                        <button
                          type="button"
                          disabled={ghBusy}
                          onClick={handlePullFromGitHub}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50"
                        >
                          <CloudUpload className="w-4 h-4" />
                          <span>Pull Files from GitHub</span>
                        </button>

                        <div className="pt-3 border-t border-slate-200 space-y-3">
                          <label className="block text-xs font-medium text-slate-700">Commit Message</label>
                          <input
                            type="text"
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            placeholder="Update landing page layout and styles"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            disabled={ghBusy}
                            onClick={handleCommitToGitHub}
                            className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                          >
                            Commit Source Files to GitHub
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Link a GitHub repository on the left to pull files or commit source changes.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: PUBLISHING & DEPLOYMENT HISTORY */}
          {activeTab === 'publishing' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <h2 className="text-base font-bold text-slate-900">Publishing Target</h2>
                <form onSubmit={handleSaveDeploymentConfig} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Hosting Provider</label>
                    <select
                      value={pubProvider}
                      disabled={!isAdminOrStaff}
                      onChange={(e) =>
                        setPubProvider(
                          e.target.value as 'managed_hosting' | 'github_pages' | 'custom_domain' | 'other'
                        )
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="managed_hosting">WebManager Hosted (Instant Live URL)</option>
                      <option value="github_pages">GitHub Pages</option>
                      <option value="custom_domain">Custom Domain (External DNS)</option>
                      <option value="other">Other Provider Adapter</option>
                    </select>
                  </div>

                  {pubProvider === 'managed_hosting' && (
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-600">
                      <p className="font-semibold text-slate-900">Built-In Static Hosting Ready</p>
                      <p>
                        No GitHub account or external host required. Publishing snapshots all saved files in Source
                        &amp; Files and serves them immediately at:
                      </p>
                      <p className="font-mono text-slate-900 break-all">
                        {window.location.origin}/sites/{detail.website.id}/
                      </p>
                    </div>
                  )}

                  {pubProvider === 'github_pages' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Deploy Branch</label>
                      <input
                        type="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={!isAdminOrStaff}
                        value={pubBranch}
                        onChange={(e) => setPubBranch(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Custom Domain {pubProvider === 'managed_hosting' ? '(Optional reference)' : ''}
                    </label>
                    <input
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={!isAdminOrStaff}
                      value={pubCustomDomain}
                      onChange={(e) => setPubCustomDomain(e.target.value)}
                      placeholder="www.clientdomain.com"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>

                  {isAdminOrStaff && detail.client && (
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={notifyClientOnPublish}
                        onChange={(e) => setNotifyClientOnPublish(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>Notify {detail.client.fullName} by email when published (when email is active)</span>
                    </label>
                  )}

                  {isAdminOrStaff && (
                    <div className="flex flex-wrap gap-3 pt-2">
                      <button
                        type="submit"
                        className="px-4 py-2 text-xs font-semibold text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                      >
                        Save Target Config
                      </button>
                      <button
                        type="button"
                        disabled={publishing}
                        onClick={handlePublish}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                      >
                        <Rocket className="w-3.5 h-3.5" />
                        <span>{publishing ? 'Publishing...' : 'Publish Now'}</span>
                      </button>
                    </div>
                  )}
                </form>

                {/* Custom Domain DNS Assistant */}
                <div className="pt-5 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-slate-700" />
                      <h3 className="text-xs font-bold text-slate-900">Custom Domain DNS Check</h3>
                    </div>
                    {isAdminOrStaff && (
                      <button
                        type="button"
                        disabled={verifyingDns}
                        onClick={handleVerifyDomain}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
                      >
                        {verifyingDns ? 'Checking DNS...' : 'Verify DNS'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">
                    Point a <span className="font-mono">CNAME</span> record for{' '}
                    <span className="font-mono text-slate-900">
                      {pubCustomDomain || siteDomain || 'your-domain.com'}
                    </span>{' '}
                    to <span className="font-mono text-slate-900">{window.location.hostname}</span>.
                  </p>
                  {(dnsCheckResult || detail.deploymentConfig?.domainVerificationResult) && (
                    <div
                      className={`p-3 rounded-lg border text-xs break-words ${
                        (dnsCheckResult ? dnsCheckResult.verified : detail.deploymentConfig?.domainVerified)
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <p className="font-semibold">
                        {(dnsCheckResult ? dnsCheckResult.verified : detail.deploymentConfig?.domainVerified)
                          ? 'DNS Verified'
                          : 'DNS Check Result'}
                      </p>
                      <p className="mt-0.5">
                        {dnsCheckResult?.message || detail.deploymentConfig?.domainVerificationResult}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-base font-bold text-slate-900">Deployment History &amp; Rollbacks</h2>
                </div>
                {detail.deployments.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500">
                    No deployments run yet. Draft changes remain local to WebManager Pro until published.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {detail.deployments.map((dep) => (
                      <div key={dep.id} className="p-5 space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 flex-wrap">
                            <StatusText status={dep.status} />
                            <span className="text-xs font-mono text-slate-500">
                              {dep.provider === 'managed_hosting' ? 'WebManager Hosted' : dep.provider}{' '}
                              {dep.commitSha ? `· ${dep.commitSha.slice(0, 7)}` : ''}
                              {dep.snapshotFileCount ? ` · ${dep.snapshotFileCount} files` : ''}
                            </span>
                            {dep.liveUrl && dep.status === 'published' && (
                              <a
                                href={dep.liveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                              >
                                <span>Visit Site</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono tabular-nums text-slate-500">
                              {new Date(dep.createdAt).toLocaleString()}
                            </span>
                            {isAdminOrStaff && dep.hasSnapshot && (
                              confirmRollbackId === dep.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={rollingBackId === dep.id}
                                    onClick={() => handleRollback(dep.id)}
                                    className="px-2.5 py-1 text-xs font-semibold text-white bg-amber-700 rounded hover:bg-amber-800 whitespace-nowrap"
                                  >
                                    {rollingBackId === dep.id ? 'Restoring...' : 'Confirm Restore'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRollbackId(null)}
                                    className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRollbackId(dep.id)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Rollback</span>
                                </button>
                              )
                            )}
                          </div>
                        </div>
                        {dep.errorMessage && (
                          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2.5 break-words">
                            {dep.errorMessage}
                          </p>
                        )}
                        {dep.logOutput && (
                          <pre className="text-xs font-mono bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">
                            {dep.logOutput}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showUrlImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 p-6 space-y-4 my-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-700" />
                <h2 className="text-lg font-bold text-slate-900">Import Website from Live URL</h2>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowUrlImportModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Fetch rendered HTML pages, CSS stylesheets, JavaScript files, fonts, and images from any public website (WordPress, Next.js/React, Shopify, Webflow, PHP/Python/Node frontends, or static HTML). Note: Private server-side code (databases, PHP/Python backend scripts) cannot be downloaded over HTTP.
            </p>

            {urlImportError && (
              <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
                {urlImportError}
              </div>
            )}

            {urlImportSummary ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 space-y-1.5 text-xs text-emerald-900">
                  <p className="font-semibold text-sm">
                    Imported {urlImportSummary.importedCount} files ({urlImportSummary.pagesImported} page
                    {urlImportSummary.pagesImported === 1 ? '' : 's'}, {urlImportSummary.assetsImported} asset
                    {urlImportSummary.assetsImported === 1 ? '' : 's'})
                  </p>
                  <p className="font-mono text-emerald-800 truncate">{urlImportSummary.finalEntryUrl}</p>
                  {urlImportSummary.detectedStack.length > 0 && (
                    <p>Detected stack: {urlImportSummary.detectedStack.join(', ')}</p>
                  )}
                </div>
                {urlImportSummary.skipped.length > 0 && (
                  <div className="max-h-32 overflow-y-auto p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
                    <p className="font-semibold">Skipped ({urlImportSummary.skipped.length}):</p>
                    {urlImportSummary.skipped.slice(0, 12).map((item, idx) => (
                      <p key={idx} className="font-mono text-[11px] truncate">
                        {item}
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUrlImportModal(false)}
                    className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleImportFromUrl} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Public Website URL *</label>
                  <input
                    type="text"
                    required
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={importUrlInput}
                    onChange={(e) => setImportUrlInput(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pages to Crawl</label>
                  <select
                    value={importMaxPages}
                    onChange={(e) => setImportMaxPages(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value={1}>Single Page (Entry URL only)</option>
                    <option value={10}>Multi-Page Site (up to 10 pages)</option>
                    <option value={20}>Full Crawl (up to 20 pages)</option>
                  </select>
                </div>
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={importIncludeExternal}
                    onChange={(e) => setImportIncludeExternal(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    Also download CSS, scripts, fonts, and images from external CDNs (recommended for WordPress, Shopify, Webflow, and Next.js sites)
                  </span>
                </label>

                <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowUrlImportModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={urlImporting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Globe className="w-4 h-4" />
                    <span>{urlImporting ? 'Importing Site...' : 'Fetch & Import Files'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
