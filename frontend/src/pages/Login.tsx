import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { mapAuthError } from '../utils/authErrors';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedEmail = email.trim();

    // Validação de campos vazios
    if (!trimmedEmail || !password) {
      setError('Por favor, preencha todos os campos.');
      return;
    }

    // Validação de e-mail robusta no cliente
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('O formato do e-mail informado é inválido.');
      return;
    }

    // Validação de força de senha no cadastro
    if (isSignUp) {
      if (password.length < 8) {
        setError('A senha deve ter pelo menos 8 caracteres para garantir sua segurança.');
        return;
      }
      const hasLetter = /[a-zA-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      if (!hasLetter || !hasNumber) {
        setError('A senha deve conter pelo menos uma letra e um número.');
        return;
      }
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error: signUpError } = await signUp({ email: trimmedEmail, password });
        if (signUpError) {
          setError(mapAuthError(signUpError));
        } else {
          setSuccess('Cadastro efetuado com sucesso! Um e-mail de confirmação foi enviado. Por favor, verifique sua caixa de entrada.');
          // Limpa formulário
          setEmail('');
          setPassword('');
          setShowPassword(false);
        }
      } else {
        const { error: signInError } = await signIn({ email: trimmedEmail, password });
        if (signInError) {
          setError(mapAuthError(signInError));
        } else {
          navigate('/');
        }
      }
    } catch (err: any) {
      setError('Falha na comunicação com o servidor de autenticação.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setError(null);
    setSuccess(null);
    setPassword('');
    setShowPassword(false);
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
          <h2 className="auth-title">
            {isSignUp ? 'Criar Conta' : 'Acessar o Sistema'}
          </h2>
          <p className="auth-subtitle">
            {isSignUp 
              ? 'Cadastre-se para tirar dúvidas de hardware e montagem de computadores.' 
              : 'Faça login com suas credenciais para continuar.'}
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

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="exemplo@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Senha</label>
            <div className="password-input-wrapper" style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                style={{ paddingRight: '44px' }}
                placeholder={isSignUp ? 'Mínimo 8 caracteres' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px',
                }}
                title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></span>
                <span>Processando...</span>
              </>
            ) : (
              <span>{isSignUp ? 'Cadastrar' : 'Entrar'}</span>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <span>
            {isSignUp ? 'Já possui uma conta?' : 'Ainda não tem conta?'}
          </span>
          <button 
            type="button" 
            className="auth-toggle-btn"
            onClick={toggleMode}
            disabled={loading}
          >
            {isSignUp ? 'Entrar aqui' : 'Cadastre-se'}
          </button>
        </div>
      </div>
    </div>
  );
}
