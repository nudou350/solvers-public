// Quem pode ler e gravar a memória de um especialista (PACKAGE_SPEC.md 11.2). Até aqui get_memory e
// save_memory aceitavam QUALQUER agent_id do catálogo: dava para gravar memória em especialista que a
// carteira nunca ativou. Agora exige licença ou uma sessão aberta (paga ou de teste grátis) com aquele agente.

export type MemoryAccessFacts = {
  /** A carteira tem licença vitalícia do especialista. */
  licensed: boolean;
  /** Existe sessão não expirada da carteira com o especialista (licença, garantia ou teste grátis). */
  openSession: boolean;
};

export const canUseMemory = (f: MemoryAccessFacts): boolean => f.licensed || f.openSession;

export const MEMORY_NO_ACCESS_TEXT = "Para usar a memória deste especialista, ative-o antes com activate_solver (teste grátis ou licença).";
