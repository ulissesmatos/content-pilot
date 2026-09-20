import { describe, expect, it } from 'vitest';
import { checkProviderModel, normalizeProviderModel } from '../src/llm/model-id';

describe('checkProviderModel', () => {
  it('remove o prefixo quando ele apenas repete o provedor — o caso de produção', () => {
    expect(checkProviderModel('openai', 'openai/gpt-4o-mini')).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      fix: 'stripped-prefix',
    });
    expect(checkProviderModel('anthropic', 'anthropic/claude-haiku-4.5')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-haiku-4.5',
      fix: 'stripped-prefix',
    });
  });

  it('mantém o provedor escolhido ao remover o prefixo — nunca redireciona', () => {
    // O usuário cadastrou chave OpenAI. Trocar para openrouter exigiria uma
    // chave que ele não tem: a correção certa é so tirar o prefixo.
    expect(checkProviderModel('openai', 'openai/gpt-5.4-nano').provider).toBe('openai');
  });

  it('id de OUTRO fornecedor não é corrigido — não existe modelo nativo equivalente', () => {
    const check = checkProviderModel('openai', 'anthropic/claude-sonnet-4.5');
    expect(check.fix).toBe('foreign-vendor');
    expect(check.vendor).toBe('anthropic');
    // id preservado: inventar "claude-sonnet-4.5" na OpenAI seria pior que o bug
    expect(check.modelId).toBe('anthropic/claude-sonnet-4.5');
    expect(check.provider).toBe('openai');
  });

  it('openrouter nunca é tocado — lá o prefixo é o endereço do modelo', () => {
    for (const id of ['openai/gpt-4o-mini', 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.2']) {
      expect(checkProviderModel('openrouter', id)).toEqual({
        provider: 'openrouter',
        modelId: id,
        fix: null,
      });
    }
  });

  it('id nativo já correto passa intacto', () => {
    expect(checkProviderModel('openai', 'gpt-4o-mini').fix).toBeNull();
    expect(checkProviderModel('anthropic', 'claude-haiku-4.5').fix).toBeNull();
  });

  it('compara o fornecedor sem diferenciar maiúsculas, preservando o id', () => {
    expect(checkProviderModel('openai', 'OpenAI/GPT-4o-mini')).toEqual({
      provider: 'openai',
      modelId: 'GPT-4o-mini',
      fix: 'stripped-prefix',
    });
  });

  it('remove só o primeiro segmento — sufixos com barra sobrevivem', () => {
    expect(checkProviderModel('anthropic', 'anthropic/claude-3.5-sonnet/beta').modelId).toBe(
      'claude-3.5-sonnet/beta',
    );
  });

  it('não corta espaços para dentro do id nem aceita prefixo vazio', () => {
    expect(checkProviderModel('openai', '  openai/gpt-4o-mini  ').modelId).toBe('gpt-4o-mini');
    // "openai/" é lixo, não prefixo: virar id vazio seria pior que recusar
    expect(checkProviderModel('openai', 'openai/').fix).toBeNull();
    expect(checkProviderModel('openai', 'openai/   ').fix).toBeNull();
    // barra no começo não tem fornecedor
    expect(checkProviderModel('openai', '/gpt-4o-mini').fix).toBeNull();
  });
});

describe('normalizeProviderModel', () => {
  it('aplica só a correção segura', () => {
    expect(normalizeProviderModel('openai', 'openai/gpt-4o-mini')).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
    });
    // fornecedor estrangeiro segue intacto para falhar com a mensagem do provedor
    expect(normalizeProviderModel('openai', 'anthropic/claude-x')).toEqual({
      provider: 'openai',
      modelId: 'anthropic/claude-x',
    });
  });

  it('é idempotente: normalizar de novo não muda nada', () => {
    const once = normalizeProviderModel('openai', 'openai/gpt-4o-mini');
    expect(normalizeProviderModel(once.provider, once.modelId)).toEqual(once);
  });
});
