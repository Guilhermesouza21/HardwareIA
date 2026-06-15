import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p className="loading-text">Verificando credenciais...</p>
      </div>
    );
  }

  // Redireciona para o login se não houver usuário autenticado
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Redireciona para a página de confirmação se o e-mail não estiver verificado
  if (!user.email_confirmed_at) {
    return <Navigate to="/verify-email" replace />;
  }

  return <>{children}</>;
}
