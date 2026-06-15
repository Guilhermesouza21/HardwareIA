import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import VerifyEmail from '../pages/VerifyEmail';
import { supabase } from '../supabaseClient';

// Mock do supabaseClient
vi.mock('../supabaseClient', () => {
  const mockAuth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getUser: vi.fn(),
    refreshSession: vi.fn(),
    resend: vi.fn(),
  };

  return {
    supabase: {
      auth: mockAuth,
    },
  };
});

describe('Sistema de Autenticação - Fluxos de Cadastro, Login, Logout e Verificação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithAuth = (initialEntries = ['/login']) => {
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/" element={<Dashboard />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  };

  // 1. Cadastro com email novo → sucesso
  it('Cadastro com e-mail novo deve retornar sucesso e orientar verificação', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: {
        user: {
          id: 'new-user-uuid',
          email: 'novo@empresa.com',
          identities: [{ id: 'identity-id' }],
        },
        session: null,
      },
      error: null,
    } as any);

    renderWithAuth();

    fireEvent.click(screen.getByText('Cadastre-se'));

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'novo@empresa.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'SenhaForte123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(screen.getByText(/Cadastro efetuado com sucesso/i)).toBeDefined();
    });
  });

  // 2. Cadastro com email duplicado → erro "já cadastrado"
  it('Cadastro com e-mail duplicado deve exibir erro claro', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: {
        user: {
          id: 'existing-user-uuid',
          email: 'duplicado@empresa.com',
          identities: [],
        },
        session: null,
      },
      error: null,
    } as any);

    renderWithAuth();

    fireEvent.click(screen.getByText('Cadastre-se'));

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'duplicado@empresa.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'SenhaForte123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(screen.getByText(/Este e-mail já está cadastrado/i)).toBeDefined();
    });
  });

  // 3. Cadastro com senha fraca (sem número) → erro de validação
  it('Cadastro com senha fraca (sem número) deve exibir erro de validação client-side', async () => {
    renderWithAuth();

    fireEvent.click(screen.getByText('Cadastre-se'));

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'teste@empresa.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'SemNumero' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(screen.getByText(/A senha deve conter pelo menos uma letra e um número/i)).toBeDefined();
    });
  });

  // 4. Login com credenciais corretas → sucesso
  it('Login com credenciais corretas deve autenticar e navegar para a Dashboard', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          email: 'correto@empresa.com',
          email_confirmed_at: '2026-06-15T00:00:00Z',
        },
        session: {},
      },
      error: null,
    } as any);

    let authCallback: any;
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });

    renderWithAuth();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'correto@empresa.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'Senha123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    if (authCallback) {
      authCallback('SIGNED_IN', {
        user: {
          id: 'user-uuid',
          email: 'correto@empresa.com',
          email_confirmed_at: '2026-06-15T00:00:00Z',
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/Fluxo de Autenticação Ativo/i)).toBeDefined();
    });
  });

  // 5. Login com senha errada → erro genérico
  it('Login com senha errada deve retornar erro genérico e ocultar qual campo falhou', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', status: 400 },
    } as any);

    renderWithAuth();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'usuario@empresa.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'SenhaErrada' } });

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(screen.getByText(/E-mail ou senha incorretos/i)).toBeDefined();
    });
  });

  // 6. Login com email não verificado → redireciona para verificação
  it('Login de conta com e-mail não verificado deve redirecionar para tela de pendência', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          email: 'pendente@empresa.com',
          email_confirmed_at: null,
        },
        session: {},
      },
      error: null,
    } as any);

    let authCallback: any;
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });

    renderWithAuth();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pendente@empresa.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'Senha123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    if (authCallback) {
      authCallback('SIGNED_IN', {
        user: {
          id: 'user-uuid',
          email: 'pendente@empresa.com',
          email_confirmed_at: null,
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/Confirme seu E-mail/i)).toBeDefined();
      expect(screen.getByText('pendente@empresa.com')).toBeDefined();
    });
  });

  // 7. Logout → sessão limpa, user é null
  it('Logout deve limpar sessão local e redirecionar para Login', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'user-uuid',
            email: 'logado@empresa.com',
            email_confirmed_at: '2026-06-15T00:00:00Z',
          },
        },
      },
    } as any);

    let authCallback: any;
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });

    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });

    const { getByText } = render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Dashboard />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.click(getByText('Sair'));

    if (authCallback) {
      authCallback('SIGNED_OUT', null);
    }

    await waitFor(() => {
      expect(screen.getByText(/Acessar o Sistema/i)).toBeDefined();
    });
  });
});
