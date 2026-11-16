import { getSupabase } from '../../../services/supabaseClient.ts';
import type { PerfilUsuario, IdentificacaoResult, PrimeiroAcessoResult, RecuperacaoCodigoResult } from '../types/auth.ts';

/**
 * Consulta o estado inicial da conta sem enumeração sensível.
 */
export async function identificarUsuario(email: string): Promise<IdentificacaoResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_identificar_usuario', { p_email: email });
  if (error) {
    console.error('[AuthService] Erro ao identificar usuário:', error);
    return { existe: false, estado_acesso: 'erro', primeiro_acesso_concluido: false, mensagem: error.message };
  }
  return data as IdentificacaoResult;
}

/**
 * Login com e-mail e senha pelo Supabase Auth.
 * Valida se o perfil está ativo e não bloqueado.
 */
export async function loginUsuario(email: string, password: string): Promise<{ sucesso: boolean; erro?: string; perfil?: PerfilUsuario }> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    return { sucesso: false, erro: 'E-mail ou senha incorretos.' };
  }

  // Obter perfil associado
  const perfilRes = await obterPerfilAtual();
  if (!perfilRes || perfilRes.bloqueado) {
    await supabase.auth.signOut();
    return {
      sucesso: false,
      erro: perfilRes?.estado_acesso === 'bloqueado'
        ? 'Sua conta está bloqueada. Entre em contato com a administração.'
        : 'Sua conta está inativa. Entre em contato com a administração.'
    };
  }

  return { sucesso: true, perfil: perfilRes };
}

/**
 * Conclui o primeiro acesso: define a senha inicial no Supabase Auth e gera os 8 códigos pessoais.
 * NÃO exige código temporário ou de recuperação.
 */
export async function concluirPrimeiroAcessoSemCodigo(
  email: string,
  novaSenha: string
): Promise<PrimeiroAcessoResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_concluir_primeiro_acesso', {
    p_email: email,
    p_nova_senha: novaSenha
  });

  if (error) {
    return { sucesso: false, erro: error.message };
  }

  return data as PrimeiroAcessoResult;
}

/**
 * Recupera a senha utilizando um dos 8 códigos pessoais de uso único.
 */
export async function recuperarSenhaComCodigo(
  email: string,
  codigo: string,
  novaSenha: string
): Promise<RecuperacaoCodigoResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_recuperar_senha_codigo', {
    p_email: email,
    p_codigo: codigo,
    p_nova_senha: novaSenha
  });

  if (error) {
    return { sucesso: false, erro: error.message };
  }

  return data as RecuperacaoCodigoResult;
}

/**
 * Solicitação de recuperação administrativa quando não possui o código pessoal.
 */
export async function solicitarRecuperacaoAdmin(email: string): Promise<{ sucesso: boolean; mensagem?: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_solicitar_recuperacao_admin', {
    p_email: email
  });

  if (error) {
    return { sucesso: false, mensagem: error.message };
  }
  return data as { sucesso: boolean; mensagem?: string };
}

/**
 * Restaura o acesso excepcional utilizando o código temporário emitido pelo Administrador.
 */
export async function restaurarAcessoComCodigoAdmin(
  email: string,
  codigo: string,
  novaSenha: string
): Promise<RecuperacaoCodigoResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('rpc_restaurar_acesso_admin', {
    p_email: email,
    p_codigo: codigo,
    p_nova_senha: novaSenha
  });

  if (error) {
    return { sucesso: false, erro: error.message };
  }

  return data as RecuperacaoCodigoResult;
}

/**
 * Obtém os dados do perfil autenticado atual.
 */
export async function obterPerfilAtual(): Promise<PerfilUsuario | null> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase.rpc('rpc_obter_meu_perfil');
  if (error || !data || !data.tem_perfil) {
    console.warn('[AuthService] Perfil não retornado para sessão:', error || data);
    return null;
  }
  return data as PerfilUsuario;
}

/**
 * Realiza o encerramento seguro da sessão.
 */
export async function logoutUsuario(): Promise<void> {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}
