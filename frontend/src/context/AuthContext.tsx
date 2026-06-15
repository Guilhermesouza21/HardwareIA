import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User, SignInWithPasswordCredentials, SignUpWithPasswordCredentials } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (credentials: SignInWithPasswordCredentials) => Promise<{ error: any }>;
  signUp: (credentials: SignUpWithPasswordCredentials) => Promise<{ error: any }>;
  signOut: () => Promise<{ error: any }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Check active session on mount
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ?? null);
      } catch (error) {
        console.error('Error fetching initial session:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Listen for changes on auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (credentials: SignInWithPasswordCredentials) => {
    try {
      const { error } = await supabase.auth.signInWithPassword(credentials);
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signUp = async (credentials: SignUpWithPasswordCredentials) => {
    try {
      const { data, error } = await supabase.auth.signUp(credentials);
      
      // Se não houver erro de API, mas as identidades do usuário vierem vazias,
      // significa que o e-mail já existe (comportamento de proteção contra enumeração do Supabase)
      if (!error && data?.user && (!data.user.identities || data.user.identities.length === 0)) {
        return {
          error: {
            message: 'User already registered',
            status: 422
          } as any
        };
      }
      
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  const refreshUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      // Se o e-mail foi confirmado, renova a sessão local para atualizar o token JWT (importante para RLS)
      if (user && user.email_confirmed_at) {
        const { data: { session } } = await supabase.auth.refreshSession();
        if (session) {
          setUser(session.user);
          return;
        }
      }
      
      setUser(user);
    } catch (err) {
      console.error('Error refreshing user session:', err);
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      setUser(null);
      return { error };
    } catch (err: any) {
      setUser(null);
      return { error: err };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
