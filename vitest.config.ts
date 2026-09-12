import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    /**
     * 测试期关掉可观测性输出。
     *
     * 路由层的 `createTrace` 会打单行 JSON，混在测试报告里既吵又会掩盖真正失败；
     * 顺便也让 `OBSERVABILITY=off` 这条开关每次跑测试都被真实执行一遍。
     */
    env: {
      OBSERVABILITY: 'off',
    },
  },
});
