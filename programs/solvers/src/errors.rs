use anchor_lang::prelude::*;

#[error_code]
pub enum SolversError {
    #[msg("Somente o admin pode fazer isso")]
    NotAdmin,
    #[msg("Somente o verificador pode fazer isso")]
    NotVerifier,
    #[msg("Somente a autoridade de uso pode fazer isso")]
    NotUsageAuthority,
    #[msg("Somente o criador pode fazer isso")]
    NotCreator,
    #[msg("Solver não está ativo")]
    AgentNotActive,
    #[msg("Solver não está pendente")]
    AgentNotPending,
    #[msg("Texto maior que o permitido")]
    StringTooLong,
    #[msg("Valor em pontos base inválido")]
    InvalidBps,
    #[msg("Preço abaixo do mínimo da plataforma")]
    PriceTooLow,
    #[msg("Solver sem pagamento por uso")]
    PayPerUseDisabled,
    #[msg("Quantidade inválida")]
    InvalidAmount,
    #[msg("Sem créditos")]
    NoCredits,
    #[msg("Nota deve ser de 1 a 5")]
    InvalidRating,
    #[msg("Sem licença ou créditos deste solver")]
    NoLicense,
    #[msg("Conta de token inválida")]
    InvalidTokenAccount,
    #[msg("Conta de licença inválida")]
    InvalidLicenseAccount,
    #[msg("Número de etapas inválido")]
    InvalidMilestones,
    #[msg("Índice de etapa inválido")]
    InvalidMilestoneIndex,
    #[msg("Etapa em estado inválido para esta ação")]
    InvalidMilestoneStatus,
    #[msg("Prazo de liberação automática ainda não venceu")]
    AutoReleaseNotReached,
    #[msg("Prazo para contestar já passou")]
    DisputeWindowClosed,
    #[msg("Somente o comprador pode fazer isso")]
    NotBuyer,
    #[msg("Comprador com disputas perdidas demais para garantia")]
    BuyerNotEligible,
    #[msg("Stake insuficiente")]
    InsufficientStake,
    #[msg("Estouro aritmético")]
    MathOverflow,
    #[msg("Janela de revisão inválida")]
    InvalidReviewWindow,
    #[msg("O preço mudou; atualize a página e tente de novo")]
    PriceChanged,
    #[msg("Esta licença já foi usada em outra avaliação")]
    LicenseAlreadyReviewed,
    #[msg("Prazo de entrega inválido")]
    InvalidDeliveryDays,
    #[msg("O prazo de entrega ainda não venceu")]
    DeliveryDeadlineNotReached,
    #[msg("O prazo de julgamento da disputa ainda não venceu")]
    DisputeSlaNotReached,
    #[msg("Taxa acima do teto da plataforma")]
    FeeTooHigh,
    #[msg("Somente quem pagou o rent pode fechar o escrow")]
    NotRentPayer,
    #[msg("Etapa já entregue e contestada: só o admin julga")]
    StaleDisputeNeedsJudgment,
    #[msg("Somente o admin indicado pode aceitar a transferência")]
    NotPendingAdmin,
    #[msg("Novo admin inválido")]
    InvalidNewAdmin,
    #[msg("Operação pausada")]
    Paused,
    #[msg("A configuração já está no layout atual")]
    ConfigAlreadyMigrated,
    #[msg("Bits de pausa inválidos")]
    InvalidPauseFlags,
    #[msg("Somente o admin ou o guardian pode alterar a pausa")]
    NotPauseAuthority,
    #[msg("O guardian só pode ligar a pausa; desligar é do admin")]
    GuardianCannotUnpause,
    #[msg("Solver em saída de stake (aposentado)")]
    AgentRetired,
    #[msg("Solver não pediu saída de stake")]
    AgentNotRetired,
    #[msg("A espera da saída de stake ainda não terminou")]
    StakeExitNotReached,
    #[msg("A espera da saída de stake já foi estendida o máximo de vezes")]
    StakeExitExtensionsExhausted,
    #[msg("Há uma proposta de confisco pendente")]
    SlashPending,
    #[msg("A espera de 72 h do confisco ainda não terminou")]
    SlashDelayNotReached,
    #[msg("A proposta de confisco já foi contestada")]
    SlashAlreadyContested,
    #[msg("Com a espera estendida pelo admin o criador não pode cancelar a saída")]
    StakeExitExtended,
    #[msg("A proposta de confisco expirou")]
    SlashExpired,
    #[msg("A proposta de confisco ainda não expirou: só o admin a cancela")]
    SlashNotExpired,
    #[msg("Você não pode comprar a sua própria licença anunciada")]
    SelfPurchase,
    #[msg("O anúncio não corresponde a este solver ou a esta licença")]
    ListingMismatch,
    #[msg("Royalty mais taxa passam do teto de 50% do preço da revenda")]
    ResaleCutTooHigh,
    #[msg("A licença não pertence à carteira indicada")]
    NotAssetOwner,
    #[msg("A licença não é deste solver")]
    AssetNotInCollection,
    #[msg("O anúncio ainda é válido: só o vendedor pode cancelá-lo")]
    ListingStillValid,
    #[msg("O criador não pode revender licenças do próprio solver")]
    CreatorCannotResell,
    #[msg("A venda desta licença não está mais autorizada: o anúncio foi invalidado")]
    ListingNotAuthorized,
    #[msg("Para cancelar com a revogação do delegate, quem paga a transação tem que ser quem abriu o anúncio")]
    CancelPayerMismatch,
}
