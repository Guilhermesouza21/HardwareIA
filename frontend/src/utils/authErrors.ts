/**
 * Traduz mensagens de erro comuns do Supabase Auth para o português.
 */
export function mapAuthError(error: any): string {
  if (!error) return 'Ocorreu um erro inesperado.';
  
  const message = error.message || '';
  const status = error.status;

  // Tradução baseada em mensagens comuns
  if (message.includes('Invalid login credentials') || message.includes('invalid_credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (message.includes('Email not confirmed') || message.includes('email_not_confirmed')) {
    return 'Este e-mail ainda não foi verificado. Por favor, confirme seu e-mail antes de fazer login.';
  }
  if (message.includes('User already registered') || message.includes('already registered')) {
    return 'Este e-mail já está cadastrado. Tente fazer login ou recuperar sua senha.';
  }
  if (message.includes('Password should be at least')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (message.includes('Email rate limit exceeded') || message.includes('rate limit')) {
    return 'Muitas tentativas em pouco tempo. Por favor, aguarde alguns minutos antes de tentar novamente.';
  }
  if (message.includes('Invalid email structure') || message.includes('invalid email')) {
    return 'O formato do e-mail informado é inválido.';
  }
  if (message.includes('network') || message.includes('Failed to fetch')) {
    return 'Erro de rede. Verifique sua conexão com a internet.';
  }
  if (status === 422) {
    return 'Dados inválidos ou incompletos.';
  }

  return message || 'Ocorreu um erro no servidor de autenticação.';
}
