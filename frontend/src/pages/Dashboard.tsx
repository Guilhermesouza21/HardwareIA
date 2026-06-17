import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  isError?: boolean;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messageLimit, setMessageLimit] = useState<{ count: number; limit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copySuccessId, setCopySuccessId] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to fetch current session access token
  const getSessionToken = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch (err) {
      console.error('Erro ao buscar token de sessão:', err);
      return null;
    }
  };

  // Scroll to bottom helper
  const scrollToBottom = () => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Trigger scroll to bottom when messages list changes
  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  // Load chat history and limit status on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const token = await getSessionToken();
        if (!token) return;

        // 1. Fetch History
        const historyRes = await fetch('/api/history', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (historyRes.ok) {
          const data = await historyRes.json();
          setMessages(data.messages || []);
        }

        // 2. Fetch limit status
        const limitRes = await fetch('/api/limit-status', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (limitRes.ok) {
          const data = await limitRes.json();
          setMessageLimit({ count: data.count, limit: data.limit });
        }
      } catch (err) {
        console.error('Erro ao carregar dados iniciais:', err);
        setError('Não foi possível carregar as informações do assistente.');
      }
    };

    loadInitialData();
  }, []);

  const handleLogout = async () => {
    try {
      if (abortController) {
        abortController.abort();
      }
      const { error } = await signOut();
      if (error) {
        console.error('Error logging out:', error);
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, retryText?: string) => {
    if (e) e.preventDefault();
    const messageText = retryText || input.trim();
    if (!messageText || isGenerating) return;

    // Enforce message limit client-side before sending
    if (messageLimit && messageLimit.count >= messageLimit.limit) {
      setError(`Você atingiu o limite de mensagens do sistema (${messageLimit.limit}/${messageLimit.limit}).`);
      return;
    }

    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: messageText }]);
    setIsGenerating(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const token = await getSessionToken();
      if (!token) {
        throw new Error('Sessão expirada. Por favor, recarregue a página e faça login novamente.');
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: messageText }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Erro interno do servidor' }));
        throw new Error(errorData.detail || 'Falha ao processar requisição');
      }

      // Add a placeholder message for the assistant stream
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Falha ao abrir stream de leitura do servidor.');
      }

      const decoder = new TextDecoder();
      let assistantResponse = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        buffer += textChunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === 'content') {
              assistantResponse += data.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantResponse };
                return updated;
              });
            } else if (data.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { 
                  role: 'assistant', 
                  content: data.message || 'Erro ao gerar resposta.', 
                  isError: true 
                };
                return updated;
              });
              return;
            }
          } catch (err) {
            console.error('Erro ao processar linha do stream:', err);
          }
        }
      }

      // Successfully finished, refresh limit counter
      const limitRes = await fetch('/api/limit-status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (limitRes.ok) {
        const data = await limitRes.json();
        setMessageLimit({ count: data.count, limit: data.limit });
      }

    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Geração interrompida pelo usuário.');
        // Clean up empty placeholder assistant bubble if generation was stopped immediately
        setMessages(prev => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
            return updated.slice(0, -1);
          }
          return updated;
        });
      } else {
        console.error('Error during message exchange:', err);
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            updated[updated.length - 1] = {
              role: 'assistant',
              content: err.message || 'Falha de comunicação com o servidor.',
              isError: true
            };
            return updated;
          }
          return updated;
        });
      }
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleStopGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  const handleClearChat = async () => {
    if (!window.confirm('Tem certeza que deseja iniciar uma nova conversa? Seu histórico anterior desta tela será arquivado.')) {
      return;
    }

    try {
      const token = await getSessionToken();
      if (!token) return;

      const response = await fetch('/api/chat/clear', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        setMessages([]);
        setError(null);
      } else {
        setError('Não foi possível reiniciar a conversa.');
      }
    } catch (err) {
      console.error('Erro ao reiniciar conversa:', err);
      setError('Erro de rede ao limpar chat.');
    }
  };

  const handleCopyMessage = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    const key = `copy-${index}`;
    setCopySuccessId(key);
    setTimeout(() => {
      setCopySuccessId(null);
    }, 2000);
  };

  const limitPercentage = messageLimit 
    ? Math.min(100, (messageLimit.count / messageLimit.limit) * 100) 
    : 0;

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <nav className="navbar">
        <div className="nav-brand">
          <svg 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            style={{ color: 'var(--primary)' }}
          >
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span>HardwareIA</span>
        </div>
        <div className="nav-user">
          <span className="nav-user-email">{user?.email}</span>
          <button 
            onClick={handleLogout} 
            className="btn btn-secondary btn-nav-logout"
          >
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sair
          </button>
        </div>
      </nav>

      {/* Main Grid Content */}
      <main className="main-content">
        <div className="dashboard-grid">
          
          {/* Sidebar */}
          <aside className="info-sidebar">
            
            {/* Session Card */}
            <div className="welcome-card-info glass-panel" style={{ margin: 0, width: '100%' }}>
              <div className="welcome-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  <path d="M2 12h20" />
                </svg>
                Sessão Ativa
              </div>
              <div className="welcome-card-row">
                <span>Status:</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Fluxo de Autenticação Ativo!</span>
              </div>
              <div className="welcome-card-row">
                <span>Usuário:</span>
                <span style={{ fontSize: '12.5px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {user?.email}
                </span>
              </div>
              <div className="welcome-card-row">
                <span>Provedor:</span>
                <span>{user?.app_metadata?.provider || 'e-mail'}</span>
              </div>
            </div>

            {/* Message Limit Card */}
            {messageLimit && (
              <div className="limit-card glass-panel">
                <div className="limit-card-header">
                  <span>Limite de Uso</span>
                  <span>{messageLimit.count} / {messageLimit.limit}</span>
                </div>
                <div className="limit-progress-bg">
                  <div 
                    className="limit-progress-bar" 
                    style={{ 
                      width: `${limitPercentage}%`,
                      backgroundColor: limitPercentage >= 100 ? 'var(--danger)' : undefined
                    }}
                  />
                </div>
                <div className="limit-text-detail">
                  {messageLimit.count >= messageLimit.limit ? (
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                      Você esgotou seu limite de mensagens.
                    </span>
                  ) : (
                    <span>
                      Você possui <strong>{messageLimit.limit - messageLimit.count}</strong> mensagens restantes.
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* Reset Chat Button */}
            <button 
              onClick={handleClearChat} 
              disabled={messages.length === 0 || isGenerating}
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', gap: '8px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              Nova Conversa
            </button>
          </aside>

          {/* Chat Panel */}
          <section className="chat-panel glass-panel">
            
            {/* Header */}
            <div className="chat-header">
              <div className="chat-header-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Assistente de Hardware</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="badge" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid rgba(6, 182, 212, 0.2)' }}>
                  Online (Llama 3.3)
                </span>
              </div>
            </div>

            {/* Messages Area */}
            <div className="messages-list">
              {messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', textAlign: 'center', padding: '0 40px' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <h3 style={{ marginBottom: '8px', color: 'var(--text-primary)' }}>Bem-vindo ao HardwareIA!</h3>
                  <p style={{ fontSize: '14px', maxWidth: '400px' }}>
                    Tire suas dúvidas sobre montagem de PCs, compatibilidade de peças, processadores, placas de vídeo e arquitetura. Pergunte qualquer coisa abaixo!
                  </p>
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={index} className={`message-item ${msg.role}`}>
                    <div className="message-avatar">
                      {msg.role === 'user' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#fff' }}>
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--bg-base)' }}>
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      )}
                    </div>
                    <div className="message-bubble">
                      {msg.role === 'user' ? (
                        <p>{msg.content}</p>
                      ) : msg.isError ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span style={{ fontWeight: 600 }}>Falha na Geração</span>
                          </div>
                          <p style={{ margin: 0, fontSize: '13.5px', color: '#fca5a5' }}>{msg.content}</p>
                          <button 
                            type="button"
                            onClick={() => {
                              const lastUserMsg = [...messages.slice(0, index)].reverse().find(m => m.role === 'user')?.content;
                              if (lastUserMsg) {
                                handleSendMessage(undefined, lastUserMsg);
                              }
                            }}
                            className="btn btn-secondary"
                            style={{ 
                              marginTop: '8px', 
                              alignSelf: 'flex-start', 
                              padding: '4px 10px', 
                              fontSize: '12px',
                              borderColor: 'rgba(239, 68, 68, 0.4)',
                              color: '#f87171',
                              backgroundColor: 'transparent'
                            }}
                          >
                            Tentar novamente
                          </button>
                        </div>
                      ) : (
                        <>
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                          {msg.content.length > 0 && (
                            <div className="message-actions">
                              <button 
                                onClick={() => handleCopyMessage(msg.content, index)}
                                className="btn-action" 
                                title="Copiar resposta"
                              >
                                {copySuccessId === `copy-${index}` ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
              
              {/* Typing Indicator Bubble */}
              {isGenerating && (
                <div className="message-item assistant">
                  <div className="message-avatar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--bg-base)' }}>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <div className="message-bubble" style={{ padding: '8px 12px' }}>
                    <div className="typing-indicator">
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                    </div>
                  </div>
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>

            {/* Error notifications */}
            {error && (
              <div style={{ padding: '0 24px' }}>
                <div className="alert-inline alert-inline-danger">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* Input area */}
            <div className="chat-input-panel">
              <form onSubmit={handleSendMessage} className="chat-input-form">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isGenerating || (messageLimit !== null && messageLimit.count >= messageLimit.limit)}
                  placeholder={
                    messageLimit !== null && messageLimit.count >= messageLimit.limit
                      ? "Limite de mensagens atingido."
                      : "Digite sua dúvida sobre hardware..."
                  }
                  className="chat-input-field"
                />
                
                {isGenerating ? (
                  <button 
                    type="button" 
                    onClick={handleStopGeneration} 
                    className="btn btn-secondary" 
                    style={{ padding: '12px 18px', display: 'flex', gap: '6px', borderColor: 'var(--danger-glow)', color: '#fca5a5' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                    Parar
                  </button>
                ) : (
                  <button 
                    type="submit" 
                    disabled={!input.trim() || (messageLimit !== null && messageLimit.count >= messageLimit.limit)}
                    className="btn" 
                    style={{ padding: '12px 18px' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                )}
              </form>
            </div>

          </section>

        </div>
      </main>
    </div>
  );
}
