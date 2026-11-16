import React, { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../services/supabaseClient.ts';
import './usuarios.css';

interface Usuario {
  id: string;
  user_id: string;
  nome: string;
  email: string;
  perfil: 'diretor' | 'regional' | 'executivo' | 'admin';
  regional_id?: string | null;
  unidade_id?: string | null;
  diretor_id?: string | null;
  ativo: boolean;
  estado_acesso: string;
  primeiro_acesso_concluido: boolean;
  criado_em: string;
  ativado_em?: string | null;
  ultimo_acesso_em?: string | null;
  senha_redefinida_em?: string | null;
  solicitacao_pendente?: boolean;
}

interface Solicitacao {
  id: string;
  user_id?: string;
  email: string;
  situacao: string;
  criado_em: string;
  resolvido_em?: string;
  nome_usuario?: string;
  admin_nome?: string;
}

interface LogAuditoria {
  id: string;
  acao: string;
  resultado: string;
  responsavel_nome: string;
  afetado_nome: string;
  detalhes: any;
  criado_em: string;
}

interface Props {
  onVoltar: () => void;
  regionaisDisponiveis?: string[];
  unidadesDisponiveis?: string[];
  diretoresDisponiveis?: string[];
}

export default function GerenciarUsuarios({
  onVoltar,
  regionaisDisponiveis = [],
  unidadesDisponiveis = [],
  diretoresDisponiveis = [],
}: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [auditorias, setAuditorias] = useState<LogAuditoria[]>([]);
  const [tab, setTab] = useState<'usuarios' | 'solicitacoes' | 'auditoria'>('usuarios');
  const [loading, setLoading] = useState(true);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroPerfil, setFiltroPerfil] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState('');

  // Modais
  const [modalNovo, setModalNovo] = useState(false);
  const [modalEditar, setModalEditar] = useState<Usuario | null>(null);
  const [modalCodigo, setModalCodigo] = useState<{ codigo: string; email: string; nome: string; expira: number } | null>(null);

  // Form novo usuário
  const [formNome, setFormNome] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPerfil, setFormPerfil] = useState<'diretor' | 'regional' | 'executivo' | 'admin'>('diretor');
  const [formRegional, setFormRegional] = useState('');
  const [formUnidade, setFormUnidade] = useState('');
  const [formDiretor, setFormDiretor] = useState('');
  const [formSalvando, setFormSalvando] = useState(false);

  async function carregarDados() {
    setLoading(true);
    setErro('');
    const supabase = getSupabase();
    try {
      const [resUsers, resSols, resAuds] = await Promise.all([
        supabase.rpc('rpc_admin_listar_usuarios'),
        supabase.rpc('rpc_admin_listar_solicitacoes'),
        supabase.rpc('rpc_admin_listar_auditoria'),
      ]);

      if (resUsers.data?.sucesso) setUsuarios(resUsers.data.usuarios || []);
      if (resSols.data?.sucesso) setSolicitacoes(resSols.data.solicitacoes || []);
      if (resAuds.data?.sucesso) setAuditorias(resAuds.data.auditoria || []);
    } catch (err: any) {
      setErro('Erro ao carregar dados administrativos: ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  // Lista filtrada
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => {
      const matchBusca =
        !busca ||
        u.nome.toLowerCase().includes(busca.toLowerCase()) ||
        u.email.toLowerCase().includes(busca.toLowerCase());
      const matchPerfil = !filtroPerfil || u.perfil === filtroPerfil;
      const matchSituacao =
        !filtroSituacao ||
        (filtroSituacao === 'ativo' && u.ativo && u.estado_acesso === 'ativo') ||
        (filtroSituacao === 'pendente' && u.estado_acesso.includes('pendente')) ||
        (filtroSituacao === 'inativo' && (!u.ativo || u.estado_acesso === 'inativo')) ||
        (filtroSituacao === 'bloqueado' && u.estado_acesso === 'bloqueado') ||
        (filtroSituacao === 'recuperacao' && u.solicitacao_pendente);
      return matchBusca && matchPerfil && matchSituacao;
    });
  }, [usuarios, busca, filtroPerfil, filtroSituacao]);

  async function handleCriarUsuario(e: React.FormEvent) {
    e.preventDefault();
    if (formPerfil === 'diretor' && !formUnidade) {
      alert('Para o perfil Diretor, é obrigatório vincular a Unidade.');
      return;
    }
    setFormSalvando(true);
    const supabase = getSupabase();
    try {
      const { data, error } = await supabase.rpc('rpc_admin_criar_usuario', {
        p_nome: formNome,
        p_email: formEmail,
        p_perfil: formPerfil,
        p_regional_id: formRegional || null,
        p_unidade_id: formUnidade || null,
        p_diretor_id: formDiretor || null,
      });

      if (error || !data?.sucesso) {
        alert('Erro ao criar usuário: ' + (error?.message || data?.erro));
        return;
      }

      setModalNovo(false);
      if (data.codigo_inicial) {
        setModalCodigo({
          codigo: data.codigo_inicial,
          email: formEmail,
          nome: formNome,
          expira: data.expira_em_minutos || 30,
        });
      } else {
        setMensagem(data.mensagem || 'Usuário cadastrado com sucesso! O primeiro acesso pode ser realizado diretamente com o e-mail.');
      }

      // Limpar formulário
      setFormNome('');
      setFormEmail('');
      setFormPerfil('diretor');
      setFormRegional('');
      setFormUnidade('');
      setFormDiretor('');

      await carregarDados();
    } finally {
      setFormSalvando(false);
    }
  }

  async function handleGerarCodigoTemporario(usuario: Usuario) {
    if (!confirm(`Deseja gerar um novo código temporário de uso único para ${usuario.nome}? Todos os códigos temporários anteriores serão revogados.`)) {
      return;
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('rpc_gerar_codigo_temporario_admin', {
      p_user_id: usuario.user_id,
      p_tipo: usuario.primeiro_acesso_concluido ? 'recuperacao_admin' : 'primeiro_acesso',
    });

    if (error || !data?.sucesso) {
      alert('Erro ao gerar código: ' + (error?.message || data?.erro));
      return;
    }

    setModalCodigo({
      codigo: data.codigo_temporario,
      email: usuario.email,
      nome: usuario.nome,
      expira: data.expira_em_minutos || 30,
    });
    await carregarDados();
  }

  async function handleAlterarEstado(usuario: Usuario, novoEstado: string) {
    const verbos: Record<string, string> = {
      ativo: 'reativar',
      inativo: 'inativar',
      bloqueado: 'bloquear',
    };
    if (!confirm(`Confirma ${verbos[novoEstado] || novoEstado} a conta de ${usuario.nome}?`)) {
      return;
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('rpc_admin_alterar_estado_usuario', {
      p_user_id: usuario.user_id,
      p_novo_estado: novoEstado,
    });

    if (error || !data?.sucesso) {
      alert('Erro ao alterar status: ' + (error?.message || data?.erro));
      return;
    }

    setMensagem(`Conta de ${usuario.nome} atualizada com sucesso.`);
    setTimeout(() => setMensagem(''), 4000);
    await carregarDados();
  }

  function formatarData(dt?: string | null) {
    if (!dt) return '—';
    try {
      return new Date(dt).toLocaleString('pt-BR');
    } catch {
      return dt;
    }
  }

  return (
    <div className="usr-page">
      <header className="usr-header">
        <div className="usr-header-left">
          <button type="button" className="mx-btn usr-btn-voltar" onClick={onVoltar}>
            ← Voltar ao Dashboard
          </button>
          <div>
            <h1>Gerenciamento de Usuários e Acessos</h1>
            <p>Controle de contas, perfis institucionais, permissões e auditoria</p>
          </div>
        </div>
        <div className="usr-header-actions">
          <button type="button" className="upload usr-btn-novo" onClick={() => setModalNovo(true)}>
            + Novo Usuário
          </button>
        </div>
      </header>

      {mensagem && <div className="usr-alert usr-alert-success">{mensagem}</div>}
      {erro && <div className="usr-alert usr-alert-error">{erro}</div>}

      {/* Navegação entre abas */}
      <div className="usr-tabs">
        <button
          type="button"
          className={`usr-tab ${tab === 'usuarios' ? 'active' : ''}`}
          onClick={() => setTab('usuarios')}
        >
          Usuários ({usuarios.length})
        </button>
        <button
          type="button"
          className={`usr-tab ${tab === 'solicitacoes' ? 'active' : ''}`}
          onClick={() => setTab('solicitacoes')}
        >
          Solicitações de Recuperação ({solicitacoes.filter(s => s.situacao === 'pendente').length})
        </button>
        <button
          type="button"
          className={`usr-tab ${tab === 'auditoria' ? 'active' : ''}`}
          onClick={() => setTab('auditoria')}
        >
          Auditoria Administrativa
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <h2>Carregando dados de usuários...</h2>
          <p>Aguarde um instante.</p>
        </div>
      ) : (
        <>
          {/* ABA 1: USUÁRIOS */}
          {tab === 'usuarios' && (
            <section className="card usr-card">
              <div className="usr-filtros">
                <input
                  type="text"
                  placeholder="Pesquisar por nome ou e-mail..."
                  className="usr-input-busca"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
                <select value={filtroPerfil} onChange={e => setFiltroPerfil(e.target.value)}>
                  <option value="">Todos os perfis</option>
                  <option value="diretor">Diretor</option>
                  <option value="regional">Regional</option>
                  <option value="executivo">Executivo</option>
                  <option value="admin">Admin</option>
                </select>
                <select value={filtroSituacao} onChange={e => setFiltroSituacao(e.target.value)}>
                  <option value="">Todas as situações</option>
                  <option value="ativo">Ativo</option>
                  <option value="pendente">Pendente 1º Acesso</option>
                  <option value="recuperacao">Recuperação Solicitada</option>
                  <option value="inativo">Inativo</option>
                  <option value="bloqueado">Bloqueado</option>
                </select>
              </div>

              <div className="table-responsive">
                <table className="usr-table">
                  <thead>
                    <tr>
                      <th>Nome / E-mail</th>
                      <th>Perfil</th>
                      <th>Vínculo Operacional</th>
                      <th>Estado da Conta</th>
                      <th>Último Acesso</th>
                      <th>Ações Administrativas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '24px' }}>
                          Nenhum usuário encontrado com os filtros aplicados.
                        </td>
                      </tr>
                    ) : (
                      usuariosFiltrados.map(u => (
                        <tr key={u.id}>
                          <td>
                            <strong>{u.nome}</strong>
                            <small className="usr-subtext">{u.email}</small>
                          </td>
                          <td>
                            <span className={`usr-badge usr-badge-${u.perfil}`}>
                              {u.perfil.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <div className="usr-vinculo">
                              {u.unidade_id && <span><b>Unidade:</b> {u.unidade_id}</span>}
                              {u.regional_id && <span><b>Regional:</b> {u.regional_id}</span>}
                              {u.diretor_id && <span><b>Diretor:</b> {u.diretor_id}</span>}
                              {!u.unidade_id && !u.regional_id && <span className="usr-dim">—</span>}
                            </div>
                          </td>
                          <td>
                            <span className={`usr-status usr-status-${u.estado_acesso}`}>
                              {u.estado_acesso.replace(/_/g, ' ')}
                            </span>
                            {u.solicitacao_pendente && (
                              <span className="usr-badge-aviso" title="Solicitou recuperação administrativa">
                                ⚠️ Recuperação
                              </span>
                            )}
                          </td>
                          <td>{formatarData(u.ultimo_acesso_em)}</td>
                          <td>
                            <div className="usr-acoes">
                              <button
                                type="button"
                                className="usr-btn-acao"
                                title="Gerar código temporário de acesso"
                                onClick={() => handleGerarCodigoTemporario(u)}
                              >
                                🔑 Código
                              </button>
                              {u.ativo && u.estado_acesso !== 'bloqueado' ? (
                                <button
                                  type="button"
                                  className="usr-btn-acao usr-btn-bloquear"
                                  onClick={() => handleAlterarEstado(u, 'bloqueado')}
                                >
                                  Bloquear
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="usr-btn-acao usr-btn-reativar"
                                  onClick={() => handleAlterarEstado(u, 'ativo')}
                                >
                                  Reativar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ABA 2: SOLICITAÇÕES DE RECUPERAÇÃO */}
          {tab === 'solicitacoes' && (
            <section className="card usr-card">
              <h2>Solicitações de Recuperação Administrativa</h2>
              <p>Usuários que não possuem os 8 códigos de recuperação e solicitaram reset à administração</p>

              <div className="table-responsive">
                <table className="usr-table">
                  <thead>
                    <tr>
                      <th>E-mail Solicitante</th>
                      <th>Usuário</th>
                      <th>Data da Solicitação</th>
                      <th>Situação</th>
                      <th>Admin Responsável</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solicitacoes.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '24px' }}>
                          Nenhuma solicitação de recuperação registrada.
                        </td>
                      </tr>
                    ) : (
                      solicitacoes.map(s => {
                        const userObj = usuarios.find(u => u.email === s.email || u.user_id === s.user_id);
                        return (
                          <tr key={s.id}>
                            <td><strong>{s.email}</strong></td>
                            <td>{s.nome_usuario || userObj?.nome || 'Não localizado'}</td>
                            <td>{formatarData(s.criado_em)}</td>
                            <td>
                              <span className={`usr-status usr-status-${s.situacao}`}>
                                {s.situacao.toUpperCase()}
                              </span>
                            </td>
                            <td>{s.admin_nome || '—'}</td>
                            <td>
                              {s.situacao === 'pendente' && userObj && (
                                <button
                                  type="button"
                                  className="mx-btn"
                                  onClick={() => handleGerarCodigoTemporario(userObj)}
                                >
                                  Atender com Código
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ABA 3: AUDITORIA */}
          {tab === 'auditoria' && (
            <section className="card usr-card">
              <h2>Auditoria de Eventos Administrativos</h2>
              <p>Histórico imutável de acessos, alterações de estado, emissão de códigos e redefinições</p>

              <div className="table-responsive">
                <table className="usr-table">
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th>Ação</th>
                      <th>Responsável</th>
                      <th>Afetado</th>
                      <th>Resultado</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditorias.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '24px' }}>
                          Nenhum registro de auditoria disponível.
                        </td>
                      </tr>
                    ) : (
                      auditorias.map(a => (
                        <tr key={a.id}>
                          <td>{formatarData(a.criado_em)}</td>
                          <td><code>{a.acao}</code></td>
                          <td>{a.responsavel_nome}</td>
                          <td>{a.afetado_nome}</td>
                          <td>
                            <span className={`usr-badge usr-badge-${a.resultado === 'sucesso' ? 'admin' : 'diretor'}`}>
                              {a.resultado.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <small className="usr-dim">
                              {a.detalhes ? JSON.stringify(a.detalhes) : '—'}
                            </small>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* MODAL: NOVO USUÁRIO */}
      {modalNovo && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '600px' }}>
            <h2>Cadastrar Novo Usuário</h2>
            <p>O usuário será criado administrativamente com primeiro acesso pendente e código temporário.</p>

            <form onSubmit={handleCriarUsuario} className="meta-form">
              <label>
                Nome Completo *
                <input
                  type="text"
                  required
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  placeholder="Nome do colaborador"
                />
              </label>

              <label>
                E-mail Institucional *
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  placeholder="usuario@ser.edu.br"
                />
              </label>

              <div className="meta-row">
                <label>
                  Perfil de Acesso *
                  <select
                    value={formPerfil}
                    onChange={e => setFormPerfil(e.target.value as any)}
                  >
                    <option value="diretor">Diretor (Visualiza apenas a própria unidade)</option>
                    <option value="regional">Regional (Visualiza regional e upload)</option>
                    <option value="executivo">Executivo (Visualiza matrizes e relatórios)</option>
                    <option value="admin">Administrador (Controle total do sistema)</option>
                  </select>
                </label>

                {formPerfil === 'diretor' && (
                  <label>
                    Unidade Obrigatória *
                    <select
                      required
                      value={formUnidade}
                      onChange={e => setFormUnidade(e.target.value)}
                    >
                      <option value="">Selecione a Unidade...</option>
                      {unidadesDisponiveis.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {(formPerfil === 'regional' || formPerfil === 'diretor') && (
                <div className="meta-row">
                  <label>
                    Regional
                    <select
                      value={formRegional}
                      onChange={e => setFormRegional(e.target.value)}
                    >
                      <option value="">Selecione a Regional (opcional)...</option>
                      {regionaisDisponiveis.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>

                  {formPerfil === 'diretor' && (
                    <label>
                      Nome do Diretor Vinculado
                      <select
                        value={formDiretor}
                        onChange={e => setFormDiretor(e.target.value)}
                      >
                        <option value="">Selecione o Diretor (opcional)...</option>
                        {diretoresDisponiveis.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: '20px' }}>
                <button type="button" onClick={() => setModalNovo(false)}>
                  Cancelar
                </button>
                <button type="submit" className="primary" disabled={formSalvando}>
                  {formSalvando ? 'Salvando...' : 'Criar e Gerar Código'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXIBIÇÃO ÚNICA DO CÓDIGO TEMPORÁRIO */}
      {modalCodigo && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '520px', textAlign: 'center' }}>
            <div className="usr-modal-icon">🔑</div>
            <h2>Código Temporário Gerado</h2>
            <p>
              Transmita este código com segurança para o usuário <strong>{modalCodigo.nome}</strong> ({modalCodigo.email}).
            </p>

            <div className="usr-codigo-destaque">
              <code>{modalCodigo.codigo}</code>
            </div>

            <div className="usr-aviso-seguranca">
              ⚠️ <strong>Atenção:</strong> Este código é de uso único, expira em {modalCodigo.expira} minutos e <strong>não poderá ser visualizado novamente</strong> após fechar esta janela.
            </div>

            <div className="modal-actions" style={{ justifyContent: 'center', marginTop: '24px' }}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  navigator.clipboard?.writeText(modalCodigo.codigo);
                  alert('Código copiado para a área de transferência!');
                }}
              >
                Copiar Código
              </button>
              <button type="button" onClick={() => setModalCodigo(null)}>
                Concluir e Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
