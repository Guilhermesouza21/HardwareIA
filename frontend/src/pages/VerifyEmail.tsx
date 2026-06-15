import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { mapAuthError } from '../utils/authErrors';

export default function VerifyEmail() {
  const { user, refreshUser, signOut } = useAuth();
  const navigate = useNavigate();
  
  const [resendLoading, setResendLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Redirecionamento inteligente:
  // Se não estiver logado, vai para login.
  // Se estiver logado E com e-mail confirmado, vai para o dashboard.
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.email_confirmed_at) {
    return <Navigate to="/" replace />;
  }

  // Polling automático a cada 5 segundos para detectar confirmação do e-mail
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshUser();
    }, 5000);

    return () => clearInterval(interval);
  }, [refreshUser]);

  // Gerenciamento do Cooldown do botão de reenvio
  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setTimeout(() => {
        setCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cooldown]);

  const handleResend = async () => {
    if (!user.email || cooldown > 0) return;

    setError(null);
    setSuccess(null);
    setResendLoading(true);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (resendError) {
        setError(mapAuthError(resendError));
      } else {
        setSuccess('E-mail de confirmação enviado com sucesso! Verifique sua caixa de entrada.');
        setCooldown(60); // Inicia temporizador de 60 segundos
      }
    } catch (err: any) {
      setError('Falha ao solicitar o reenvio de e-mail.');
      console.error(err);
    } finally {
      setResendLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setError(null);
    setSuccess(null);
    setRefreshLoading(true);
    
    try {
      await refreshUser();
      // O redirecionamento ocorrerá no topo devido ao if(user.email_confirmed_at)
    } catch (err: any) {
      setError('Não foi possível atualizar o status da conta.');
    } finally {
      setRefreshLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-logo">
            <svg 
              className="auth-logo-icon" 
              width="32" 
              height="32" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>HardwareIA</span>
          </div>
          <h2 className="auth-title">Confirme seu E-mail</h2>
          <p className="auth-subtitle">
            Enviamos um link de confirmação para o e-mail:
          </p>
          <div style={{ margin: '12px 0', fontWeight: '600', color: 'var(--primary)', wordBreak: 'break-all' }}>
            {user.email}
          </div>
          <p className="auth-subtitle" style={{ fontSize: '13px', marginTop: '8px' }}>
            Por favor, clique no link contido na mensagem para ativar sua conta e liberar o acesso.
          </p>
        </div>

        {error && (
          <div className="alert-box alert-box-danger">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="alert-box alert-box-success">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{success}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button 
            type="button" 
            className="btn btn-primary"
            onClick={handleManualRefresh}
            disabled={refreshLoading || resendLoading}
          >
            {refreshLoading ? (
              <>
                <span className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></span>
                <span>Verificando...</span>
              </>
            ) : (
              <span>Já confirmei meu e-mail</span>
            )}
          </button>

          <button 
            type="button" 
            className="btn btn-secondary"
            onClick={handleResend}
            disabled={resendLoading || refreshLoading || cooldown > 0}
          >
            {resendLoading ? (
              <>
                <span className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></span>
                <span>Reenviando...</span>
              </>
            ) : cooldown > 0 ? (
              <span>Reenviar e-mail ({cooldown}s)</span>
            ) : (
              <span>Reenviar e-mail de confirmação</span>
            )}
          </button>
          
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={handleLogout}
            style={{ marginTop: '12px', borderColor: 'var(--danger-glow)', color: '#f87171' }}
          >
            Usar outra conta / Sair
          </button>
        </div>
      </div>
    </div>
  );
}
