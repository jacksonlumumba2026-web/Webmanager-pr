import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import {
  ApiError,
  apiRequest,
  clearApiCache,
  isNetworkError,
  setApiCacheScope,
  setApiTokenProvider,
} from '../services/api.ts';
import type {
  ClientRecord,
  Organization,
  OrganizationMembership,
  PublicBrand,
  UserProfile,
} from '../types/index.ts';

interface AuthMeResponse {
  profile: UserProfile;
  organization: Organization;
  membership: OrganizationMembership;
  clientRecord: ClientRecord | null;
}

interface AuthContextValue {
  loading: boolean;
  authenticated: boolean;
  profile: UserProfile | null;
  organization: Organization | null;
  membership: OrganizationMembership | null;
  clientRecord: ClientRecord | null;
  brand: PublicBrand;
  isAdminOrStaff: boolean;
  isAdmin: boolean;
  isClient: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerAgency: (params: {
    fullName: string;
    email: string;
    password: string;
    organizationName: string;
  }) => Promise<void>;
  acceptInvite: (params: { token: string; fullName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshBrand: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
}

const DEFAULT_BRAND: PublicBrand = {
  name: 'WebManager Pro',
  primaryColor: '#0F172A',
  accentColor: '#1D4ED8',
  brandLogoUrl: null,
  supportEmail: null,
};

const SESSION_TOKEN_KEY = 'wmp_session_token_v1';
const AUTH_ME_CACHE_KEY = 'wmp_auth_me_v1';
const BRAND_CACHE_KEY = 'wmp_brand_v1';

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function readCachedMe(identityHint: string): AuthMeResponse | null {
  if (typeof window === 'undefined' || !identityHint) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_ME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hint?: string; data?: AuthMeResponse };
    if (parsed.hint === identityHint && parsed.data?.profile?.id) {
      return parsed.data;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function writeCachedMe(identityHint: string, data: AuthMeResponse | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!data || !identityHint) {
      window.localStorage.removeItem(AUTH_ME_CACHE_KEY);
    } else {
      window.localStorage.setItem(AUTH_ME_CACHE_KEY, JSON.stringify({ hint: identityHint, data }));
    }
  } catch {
    // Ignore storage errors
  }
}

function readCachedBrand(): PublicBrand {
  if (typeof window === 'undefined') return DEFAULT_BRAND;
  try {
    const raw = window.localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return DEFAULT_BRAND;
    return { ...DEFAULT_BRAND, ...(JSON.parse(raw) as Partial<PublicBrand>) };
  } catch {
    return DEFAULT_BRAND;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialStoredToken = readStoredToken();
  const initialCachedMe = initialStoredToken ? readCachedMe(initialStoredToken.slice(0, 24)) : null;

  const [loading, setLoading] = useState(!initialCachedMe);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const customTokenRef = useRef<string | null>(initialStoredToken);

  const [profile, setProfile] = useState<UserProfile | null>(initialCachedMe?.profile ?? null);
  const [organization, setOrganization] = useState<Organization | null>(
    initialCachedMe?.organization ?? null
  );
  const [membership, setMembership] = useState<OrganizationMembership | null>(
    initialCachedMe?.membership ?? null
  );
  const [clientRecord, setClientRecord] = useState<ClientRecord | null>(
    initialCachedMe?.clientRecord ?? null
  );
  const [brand, setBrand] = useState<PublicBrand>(() => readCachedBrand());

  if (initialCachedMe?.profile?.id) {
    setApiCacheScope(initialCachedMe.profile.id);
  }

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    if (customTokenRef.current) {
      return customTokenRef.current;
    }
    if (auth.currentUser) {
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        // Fallback when offline: Firebase SDK may fail refreshing expired ID token
        return null;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    setApiTokenProvider(getAuthToken);
  }, [getAuthToken]);

  const applyMe = useCallback((me: AuthMeResponse, hint: string) => {
    setProfile(me.profile);
    setOrganization(me.organization);
    setMembership(me.membership);
    setClientRecord(me.clientRecord);
    setApiCacheScope(me.profile.id);
    writeCachedMe(hint, me);
    const nextBrand: PublicBrand = {
      name: me.organization.name,
      primaryColor: me.organization.primaryColor,
      accentColor: me.organization.accentColor,
      brandLogoUrl: me.organization.brandLogoUrl,
      supportEmail: me.organization.supportEmail,
    };
    setBrand(nextBrand);
    try {
      window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(nextBrand));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const clearAuthState = useCallback(() => {
    customTokenRef.current = null;
    writeStoredToken(null);
    writeCachedMe('', null);
    setApiCacheScope(null);
    clearApiCache();
    setProfile(null);
    setOrganization(null);
    setMembership(null);
    setClientRecord(null);
  }, []);

  const refreshBrand = useCallback(async () => {
    try {
      const data = await apiRequest<PublicBrand>('/api/public/brand');
      setBrand(data);
      try {
        window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(data));
      } catch {
        // Ignore storage errors
      }
    } catch {
      // Keep cached/default brand on transient error
    }
  }, []);

  const refreshMe = useCallback(async () => {
    const customTok = customTokenRef.current;
    const fbUid = auth.currentUser?.uid;
    const hint = customTok ? customTok.slice(0, 24) : fbUid ? `fb:${fbUid}` : '';
    const token = await getAuthToken();

    if (!token) {
      // If offline with a Firebase user or stored session, keep cached profile if available
      if (hint && typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = readCachedMe(hint);
        if (cached) {
          applyMe(cached, hint);
          return;
        }
      }
      setProfile(null);
      setOrganization(null);
      setMembership(null);
      setClientRecord(null);
      return;
    }

    try {
      const me = await apiRequest<AuthMeResponse>('/api/auth/me', { skipCacheFallback: true });
      applyMe(me, hint);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearAuthState();
        throw err;
      }
      if (isNetworkError(err) && hint) {
        const cached = readCachedMe(hint);
        if (cached) {
          applyMe(cached, hint);
          return;
        }
      }
      throw err;
    }
  }, [applyMe, clearAuthState, getAuthToken]);

  useEffect(() => {
    refreshBrand();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        customTokenRef.current = null;
        writeStoredToken(null);
        const fbHint = `fb:${user.uid}`;
        const cached = readCachedMe(fbHint);
        if (cached) {
          applyMe(cached, fbHint);
          setLoading(false);
        }
        try {
          await refreshMe();
        } catch (err) {
          console.error('Failed to sync authenticated profile:', err);
          if (!(isNetworkError(err) && cached)) {
            setProfile(null);
          }
        }
      } else if (customTokenRef.current) {
        const tokHint = customTokenRef.current.slice(0, 24);
        const cached = readCachedMe(tokHint);
        if (cached) {
          applyMe(cached, tokHint);
          setLoading(false);
        }
        try {
          await refreshMe();
        } catch (err) {
          if (!(isNetworkError(err) && cached)) {
            clearAuthState();
          }
        }
      } else {
        setProfile(null);
        setOrganization(null);
        setMembership(null);
        setClientRecord(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [applyMe, clearAuthState, refreshBrand, refreshMe]);

  const loginWithGoogle = async () => {
    customTokenRef.current = null;
    writeStoredToken(null);
    await signInWithPopup(auth, googleAuthProvider);
    await refreshMe();
  };

  const loginWithPassword = async (email: string, password: string) => {
    if (auth.currentUser) {
      await signOut(auth);
    }
    const res = await apiRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    customTokenRef.current = res.token;
    writeStoredToken(res.token);
    await refreshMe();
  };

  const registerAgency = async (params: {
    fullName: string;
    email: string;
    password: string;
    organizationName: string;
  }) => {
    if (auth.currentUser) {
      await signOut(auth);
    }
    const res = await apiRequest<{ token: string }>('/api/auth/register-agency', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    customTokenRef.current = res.token;
    writeStoredToken(res.token);
    await refreshMe();
  };

  const acceptInvite = async (params: { token: string; fullName: string; password: string }) => {
    if (auth.currentUser) {
      await signOut(auth);
    }
    const res = await apiRequest<{ token: string }>('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    customTokenRef.current = res.token;
    writeStoredToken(res.token);
    await refreshMe();
  };

  const logout = async () => {
    clearAuthState();
    if (firebaseUser || auth.currentUser) {
      await signOut(auth);
    }
  };

  const role = membership?.role;
  const isAdmin = role === 'super_admin' || role === 'agency_admin';
  const isAdminOrStaff = isAdmin || role === 'staff';
  const isClient = role === 'client';

  return (
    <AuthContext.Provider
      value={{
        loading,
        authenticated: Boolean(profile),
        profile,
        organization,
        membership,
        clientRecord,
        brand,
        isAdminOrStaff,
        isAdmin,
        isClient,
        loginWithGoogle,
        loginWithPassword,
        registerAgency,
        acceptInvite,
        logout,
        refreshMe,
        refreshBrand,
        getAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

