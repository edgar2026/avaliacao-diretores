import React from 'react';

/**
 * Error Boundary da área principal. Um erro de renderização (ex.: gráfico
 * falhando com dados inesperados) não pode derrubar a aplicação inteira:
 * este componente captura o erro, registra o detalhe técnico no console de
 * desenvolvimento (sem expor chaves/segredos) e exibe um estado de erro
 * visível com botão "Tentar novamente", mantendo o restante da tela.
 */
interface ErrorBoundaryProps {
  titulo?: string;
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState>{
  constructor(props: ErrorBoundaryProps){
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error as Error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo){
    // Somente mensagem + stack; nada de variáveis de ambiente ou chaves.
    console.error('[avaliacao-diretores] Erro de renderização capturado:',
      error?.message || String(error), info?.componentStack || '');
  }

  render(){
    if(this.state.error){
      return <section className="empty-state" role="alert">
        <h2>{this.props.titulo || 'Ocorreu um erro ao exibir esta área'}</h2>
        <p>{String(this.state.error?.message || this.state.error)}</p>
        <button className="save" onClick={() => this.setState({ error: null })}>Tentar novamente</button>
      </section>;
    }
    return this.props.children;
  }
}
