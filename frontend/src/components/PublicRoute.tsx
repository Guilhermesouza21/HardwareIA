import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface PublicRouteProps {
  children: React.ReactNode;
}

/**
 * PublicRoute — protege rotas públicas (ex: /login) contra acesso
 * de usuários que já estão autenticados e com e-mail confirmado.
 *
 * Fluxo:
 *   - Carregando sessão  → exibe spinner
 *   - Logado e confirmado → redireciona para o dashboard (/)
 *   - Não logado ou não confirmado → exibe a rota normalmente
 */
export function PublicRoute({ children }: PublicRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p className="loading-text">Verificando credenciais...</p>
      </div>
    );
  }

  // Usuário autenticado e com e-mail confirmado não deve ver /login
  if (user && user.email_confirmed_at) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
