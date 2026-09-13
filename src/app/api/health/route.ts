import { NextResponse } from 'next/server';

import { engineLights, modeMeta, modeOf, type RuntimeCapability } from '@/core/run/runtimeMode';
import { resolveModelConfigForRequest, resolveZhihuConfigForRequest, secretOriginFor } from '@/features/run/keyResolution';
import { resolveIdentity } from '@/features/run/identity';
import { describeTiers, resolveTieredModels } from '@/agents/tieredRouting';

/**
 * 运行模式与引擎健康状态（v2 §11 / §20.1）。
 *
 * **客户端只接收健康状态，不接收任何密钥值** —— 这是 v2 §24 的硬规则：
 * Key 永远只在服务端；客户端只拿到「在线 / 离线」这种布尔结论。
 *
 * 界面据此显示三个引擎指示灯，并在 `ai` / `demo` 模式下如实告知能力边界。
 * 之所以不让前端自己拼条件：模式必须由**服务端真实能力**决定，
 * 否则会出现「配了 key 却还显示演示模式」或反过来「没 key 却宣称在线」。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  /**
   * 模式由**这个身份自己配了什么**决定，而不是由服务端环境变量决定。
   *
   * 这样才诚实：
   * - 没配 key 的访客看到的是 DEMO（我们不会替他付账）；
   * - 自己在 `/settings` 填了 key 之后，同一个页面立刻变成 FULL。
   *
   * 产品化方案 §5 之后，来源有三档：`account`（用户自己配的）> `app`
   * （服务器配的，普通用户打开即用）> `none`（离线兜底）。这里只报**来源**，
   * 永不回传 key 值；界面据此如实说明「这一局用的是谁的模型」。
   */
  const modelConfig = resolveModelConfigForRequest(request);
  const zhihuConfig = resolveZhihuConfigForRequest(request);
  const identity = resolveIdentity(request);
  const secretOrigin = secretOriginFor(request);

  const capability: RuntimeCapability = {
    aiKey: modelConfig !== null,
    zhihuKey: zhihuConfig !== null,
  };

  const mode = modeOf(capability);
  const meta = modeMeta(mode);
  const tiers = resolveTieredModels();

  return NextResponse.json(
    {
      ok: true,
      mode,
      capability,
      /** 该身份是否已登录知乎账号（不影响能否配置 key，只影响记忆）。 */
      authenticated: identity.authenticated,
      /** 该身份是否需要自己去 `/settings` 填 key 才能用 AI。 */
      needsOwnKey: modelConfig === null,
      title: meta.title,
      notice: meta.notice,
      evidenceCanJudge: meta.evidenceCanJudge,
      lights: engineLights(mode),
      /**
       * 密钥来源：`account` / `app` / `none`。
       *
       * 它决定界面该说「你在用自己的模型」还是「本局用服务器提供的模型」——
       * 用户有权知道这一局花的是谁的钱。
       */
      secretOrigin,
      // 只报模型名与端点，不含密钥
      model: modelConfig ? { name: modelConfig.model, baseUrl: modelConfig.baseUrl } : null,
      zhihu: zhihuConfig ? { baseUrl: zhihuConfig.baseUrl } : null,
      // 快慢双流的说明（不含密钥）
      tiering: { ...tiers, description: describeTiers(resolveTieredModels()) },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
