import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes ponta a ponta migram o MESMO banco de teste. Em paralelo, dois deles criando
    // as tabelas de um banco vazio ao mesmo tempo colidem (pg_type_typname_nsp_index).
    fileParallelism: false,
  },
});
