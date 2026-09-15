import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('首屏与世界编译延迟预算', () => {
  it('穿越动画固定收束，不再绑定整个创建请求', () => {
    const home = source('src/app/page.tsx');
    expect(home).toContain('const ENTER_MS = 720');
    expect(home).toContain('setJumping(false)');
    expect(home).toContain('<UniverseJump active={jumping}');
    expect(home).not.toContain('<UniverseJump active={launching}');
  });

  it('首页创建会话不等待模型画像', () => {
    const route = source('src/app/api/sessions/route.ts');
    expect(route).toContain("trace.note('profile-deterministic-fast-path')");
    expect(route).not.toContain('await generateProfile');
  });

  it('世界编译只保留一次必要的模型归纳', () => {
    const service = source('src/features/decision-session/service.ts');
    expect(service).toContain('router: null');
    expect(service).toContain('router: deps.router ?? null');
    expect(service).toContain('const blueprint = compiled');
    expect(service).not.toContain('await withUnlockTitles');
  });

  it('角色与知乎请求都有真实生效的短超时', () => {
    const router = source('src/agents/providerRouter.ts');
    const route = source('src/app/api/sessions/[id]/route.ts');
    expect(router).toContain('Math.min(credential.timeoutMs, plan.timeoutMs)');
    expect(route).toContain('Math.min(zhihu.timeoutMs, 6_000)');
  });

  it('编译完成后移动端直接交接到逐页显影', () => {
    const page = source('src/app/session/[id]/page.tsx');
    const reveal = source('src/components/visual/ExperienceReveal.tsx');
    expect(page).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })");
    expect(page).toContain('worldReady && foundTotal > 0 ? null');
    expect(page).toContain('compileElapsed');
    expect(reveal).toContain('}, 2200)');
  });
});
