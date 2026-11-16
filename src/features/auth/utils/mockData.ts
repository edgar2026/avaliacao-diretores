// Dados simulados para demonstração visual do fluxo de acesso.
// NADA é persistido. Nenhum dado real é consultado.

export const MOCK_RECOVERY_CODES = [
  'ADR7-K3M9-PX2W',
  'BN5T-QH8V-ZL4J',
  'CF2R-WY6N-MS9D',
  'DG4K-AE7P-VT3X',
  'EJ9W-LC5H-QB8M',
  'FK6N-RD2T-YA7G',
  'GL3V-MF8J-XC5P',
  'HM7X-PB4Q-KW2R',
];

export const MOCK_USERS: Record<string, { name: string; isFirstAccess: boolean }> = {
  'diretor@ser.edu.br': { name: 'Carlos Eduardo Mendes', isFirstAccess: false },
  'novo@ser.edu.br': { name: 'Ana Beatriz Costa', isFirstAccess: true },
};

/** Simula a verificação de e-mail (delay artificial). */
export function simulateEmailCheck(email: string): Promise<'active' | 'first-access' | 'not-found'> {
  return new Promise(resolve => {
    setTimeout(() => {
      const user = MOCK_USERS[email.trim().toLowerCase()];
      if (!user) resolve('not-found');
      else if (user.isFirstAccess) resolve('first-access');
      else resolve('active');
    }, 1200);
  });
}

/** Simula ação genérica com delay. */
export function simulateAction(ms = 1500): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
