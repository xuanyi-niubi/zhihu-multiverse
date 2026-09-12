'use client';

import * as React from 'react';

import { engineLights, modeMeta, type RuntimeMode } from '@/core/run/runtimeMode';
import { fetchHealth, type HealthView } from '@/core/evidence/meshClient';

/**
 * 引擎状态条（v2 §11.1 / §20.1）。
 *
 * 三个指示灯 + 当前模式说明。两条纪律：
 *
 * 1. **只显示在线 / 离线，不显示任何密钥** —— 状态来自服务端 `/api/health`，
 *    客户端从头到尾拿不到 key（v2 §24）。
 * 2. **降级必须显式**：`ai` / `demo` 模式下必须把能力边界写在脸上，
 *    而不是让评委以为一切都开着。宁可少宣称，不要谎报在线。
 *
 * 路演时这一条就是「绝不现场粘 Key」的替代方案：提前配好环境变量，
 * 上台只展示这三个灯。
 */

export interface EngineStatusBarProps {
  /** 外部已拿到的健康状态；不传则组件自己拉一次。 */
  readonly health?: HealthView | null;
  /** 紧凑模式（推演舱顶部）或完整模式（首页 / 路演页）。 */
  readonly compact?: boolean;
  readonly className?: string;
}

/** 三行指示灯文本 → 结构化（左对齐等宽显示，像终端）。 */
function parseLight(text: string): { readonly label: string; readonly state: string; readonly online: boolean } {
  const online = text.includes('●');
  const [label, state] = text.split(/\s{2,}/);
  return {
    label: (label ?? '').trim(),
    state: (state ?? (online ? '● ONLINE' : '○ OFFLINE')).trim(),
    online,
  };
}

export function EngineStatusBar({ health = null, compact = false, className = '' }: EngineStatusBarProps) {
  const [own, setOwn] = React.useState<HealthView | null>(health);

  React.useEffect(() => {
    if (health) {
      setOwn(health);
      return;
    }
    const controller = new AbortController();
    void fetchHealth({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setOwn(result);
      }
    });
    return () => controller.abort();
  }, [health]);

  const view = health ?? own;
  const mode: RuntimeMode = view?.mode ?? 'demo';
  const meta = modeMeta(mode);
  const lights = view?.lights ?? engineLights('demo');

  const rows = [lights.ai, lights.zhihu, lights.world].map(parseLight);

  return (
    <section
      aria-label="引擎状态"
      className={[
        'overflow-hidden rounded-xl border bg-black/20 backdrop-blur-sm',
        mode === 'full' ? 'border-emerald-400/25' : 'border-amber-400/30',
        className,
      ].join(' ')}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-slate-200">
          <span
            className={[
              'inline-block h-2 w-2 rounded-full',
              mode === 'full' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(61,214,160,0.9)]' : 'bg-amber-400 shadow-[0_0_8px_rgba(245,184,65,0.9)]',
            ].join(' ')}
            aria-hidden="true"
          />
          {meta.title}
        </span>
        <span className="font-mono text-[10px] text-slate-500">
          MODE {mode.toUpperCase()}
        </span>
      </header>

      <div className={compact ? 'px-3.5 py-2' : 'px-3.5 py-3'}>
        <ul className="grid grid-cols-3 gap-2">
          {rows.map((row) => (
            <li key={row.label} className={compact ? 'rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-1.5 font-mono text-[9px]' : 'rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 font-mono text-[9px]'}>
              <span className="block truncate text-slate-500">{row.label}</span>
              <span className={[
                compact ? 'mt-0.5 block truncate text-[9px]' : 'mt-1 block truncate text-[10px]',
                row.online ? 'text-emerald-300' : 'text-slate-500',
              ].join(' ')}>{row.state}</span>
            </li>
          ))}
        </ul>

        {!compact ? (
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{meta.notice}</p>
        ) : null}

        {/*
          这里**刻意不展示模型名与分档细节**（2026-09-12 修正）。

          原因是一次真实的误读：这一行原本写着
          `deepseek-chat · 单流模式：全部角色使用 deepseek-chat（未配置 DM_FAST_MODEL…）`，
          结果被读成「AI 没接入」—— 而实际上 AI 正在工作。

          三条教训：
          1. **第一屏只回答「能不能用」，不回答「怎么实现的」**。
             模型名对玩家与评委没有信息量，反而暴露我们的技术选型；
          2. **不要暴露内部术语**（「单流 / 分档」是运维词汇，不是产品语言）；
          3. 误读的代价是不对称的：写着「单流」时即便功能正常，
             也会让人怀疑整条链路没接上。

          诊断信息没有丢 —— 它完整保留在 `GET /api/health` 的 JSON 里
          （`model` / `tiering` 字段），运维与排查照常可用。
        */}
      </div>
    </section>
  );
}

export default EngineStatusBar;
