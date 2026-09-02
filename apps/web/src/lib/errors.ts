/**
 * Erro cuja mensagem pode ser exibida ao usuário.
 *
 * A borda das actions só repassa a mensagem de um UserFacingError (ou de um
 * PlanLimitError, que também é escrito para o usuário). Qualquer outro erro
 * vira mensagem genérica: mensagens cruas vazam nome de tabela, SQL, caminho
 * de arquivo e, no pior caso, valor de segredo.
 *
 * `code` é opcional e serve para o client traduzir via i18n em vez de exibir
 * a string do servidor.
 */
export class UserFacingError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}
