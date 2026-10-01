// Contrato de erros da revenda de licenças entre servidor, chain e web (rotas em packages/api-client):
//   POST /api/tx/list            { licenseId, priceUsdc }
//   POST /api/tx/buy-listing     { licenseId, expectedPriceUsdc }
//   POST /api/tx/cancel-listing  { licenseId }
//   GET  /api/market/listings?agent=<slug>
// O corpo de erro segue o padrão do servidor: `{ error: <mensagem>, code: <código abaixo>, ...extra }` (`priceUsdc` em
// `listing_changed`, com o preço atual do anúncio). A web traduz o `code`; o status é o de `RESALE_ERROR_HTTP_STATUS`.

export const RESALE_ERROR_CODES = {
  /** 503: a revenda está desligada (`PublicConfig.resaleEnabled === false`). */
  resaleDisabled: "resale_disabled",
  /** 404: não há anúncio ativo para a licença (nunca existiu, foi vendido, cancelado ou ficou inválido). */
  listingNotFound: "listing_not_found",
  /** 409: o preço do anúncio mudou desde que o comprador o viu (traz `priceUsdc`). */
  listingChanged: "listing_changed",
  /** 403: a licença não é da carteira (anunciar) ou só o vendedor cancela um anúncio ainda válido. */
  notOwner: "not_owner",
  /** 400: o comprador é o próprio vendedor. */
  ownListing: "own_listing",
  /** 400: preço abaixo do mínimo da plataforma. */
  priceTooLow: "price_too_low",
  /** 409: a licença já tem um anúncio válido. */
  alreadyListed: "already_listed",
  /** 400: royalty + taxa passam do teto (`RESALE_MAX_CUT_BPS`). */
  cutTooHigh: "cut_too_high",
  /** 400: solver suspenso, aposentado ou sem stake mínimo (já existia no servidor). */
  agentUnavailable: "agent_unavailable",
  /** Já existiam no servidor (saldo e rejeição na simulação). */
  insufficientFunds: "insufficient_funds",
  operationRejected: "operation_rejected",
  /** 400: o criador não revende licenças do próprio solver (MVP). */
  creatorCannotResell: "creator_cannot_resell",
  /** 409: o vendedor não pode cancelar por aqui (a taxa não é paga pela plataforma): deve revogar o delegate na carteira. */
  cancelViaWallet: "cancel_via_wallet",
  /** 400: o asset não é uma licença válida (inexistente, fora de coleção conhecida). */
  licenseInvalid: "license_invalid",
} as const;

export type ResaleErrorCode = (typeof RESALE_ERROR_CODES)[keyof typeof RESALE_ERROR_CODES];

export const RESALE_ERROR_HTTP_STATUS: Record<ResaleErrorCode, number> = {
  resale_disabled: 503,
  listing_not_found: 404,
  listing_changed: 409,
  not_owner: 403,
  own_listing: 400,
  price_too_low: 400,
  already_listed: 409,
  cut_too_high: 400,
  agent_unavailable: 400,
  insufficient_funds: 400,
  operation_rejected: 409,
  creator_cannot_resell: 400,
  cancel_via_wallet: 409,
  license_invalid: 400,
};
