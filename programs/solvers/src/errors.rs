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
}
