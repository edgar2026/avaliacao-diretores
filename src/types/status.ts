// Status de gestão conhecidos (ordem exibida no aplicativo). A planilha pode
// trazer texto livre em `estagio`/`status`; por isso o tipo Status combina o
// conjunto conhecido com string (string & {} mantém autocompletar).
export type StatusConhecido =
  | 'Acompanhamento'
  | 'Supervisão I'
  | 'Supervisão II'
  | 'Gestão I'
  | 'Gestão II'
  | 'Delegação I'
  | 'Delegação II'
  | 'Reposicionamento';

export type Status = StatusConhecido | (string & {});

// Nível: algarismo romano no modelo/UI (I..V) e valor numérico 1..5 no domínio
// (nível null = "Não informado").
export type NivelAlgarismo = 'I' | 'II' | 'III' | 'IV' | 'V';
export type NivelRoman = 1 | 2 | 3 | 4 | 5;
export type Nivel = NivelAlgarismo | 'Não informado';
export type NivelExibicao = `(${NivelAlgarismo})` | null;

// Origem de um dado vigente no modelo: veio da planilha ou foi gravado por
// cadastro/edição manual.
export type OrigemDado = 'planilha' | 'cadastro_manual';
