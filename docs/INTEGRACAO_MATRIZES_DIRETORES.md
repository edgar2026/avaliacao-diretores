# Componente Matrizes de Diretores

Arquivos:

- `MatrizesDiretores.tsx`: componente React + TypeScript.
- `MatrizesDiretores.css`: estilos isolados pelo prefixo `md-`.

## Onde inserir no Sistema de Avaliação de Diretores

Sugestão de destino:

```text
src/features/matrizes/components/MatrizesDiretores.tsx
src/features/matrizes/components/MatrizesDiretores.css
```

Se o projeto ainda não usa a pasta `features`, use:

```text
src/components/MatrizesDiretores/MatrizesDiretores.tsx
src/components/MatrizesDiretores/MatrizesDiretores.css
```

## Uso mínimo

```tsx
import MatrizesDiretores, {
  type MatrixData,
  type MatrixMove,
} from '@/features/matrizes/components/MatrizesDiretores';

const data: MatrixData = {
  ninebox: Array.from({ length: 9 }, () => []),
  risk: Array.from({ length: 16 }, () => []),
};

export function PaginaMatrizes() {
  async function handleMove(move: MatrixMove, nextData: MatrixData) {
    // A IA do VS Code deve conectar esta função ao service/Supabase do sistema.
    console.log(move, nextData);
  }

  return (
    <MatrizesDiretores
      initialData={data}
      persistLocally={false}
      onDirectorMove={handleMove}
    />
  );
}
```

## Ponto de navegação recomendado

Adicionar uma rota protegida no roteador já existente:

```tsx
{
  path: '/matrizes',
  element: <PaginaMatrizes />,
}
```

E inserir no menu do Sistema de Avaliação de Diretores:

```tsx
<NavLink to="/matrizes">Matrizes</NavLink>
```

O próprio componente já contém os botões de navegação entre:

- Ninebox
- Matriz Risco × Dano

## Contrato para conectar aos dados reais

`MatrixData.ninebox` deve conter exatamente 9 grupos, nesta ordem:

1. Alto + Abaixo do esperado
2. Alto + Esperado
3. Alto + Acima do esperado
4. Médio + Abaixo do esperado
5. Médio + Esperado
6. Médio + Acima do esperado
7. Baixo + Abaixo do esperado
8. Baixo + Esperado
9. Baixo + Acima do esperado

`MatrixData.risk` deve conter exatamente 16 grupos em ordem de linha:

- Risco: Altíssimo, Alto, Médio, Baixo
- Dano: Baixo, Médio, Alto, Altíssimo

Cada diretor precisa deste formato:

```ts
{
  id: string;
  name: string;
  unit: string;
}
```

## Persistência

- Para conectar ao banco real, use `persistLocally={false}` e implemente `onDirectorMove`.
- Para uma prévia local sem banco, use `persistLocally={true}`.
- O componente não executa SQL e não altera o Supabase sozinho.
