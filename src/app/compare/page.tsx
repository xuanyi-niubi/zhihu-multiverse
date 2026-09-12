'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { AxisSlider } from '@/components/AxisSlider';
import { SandwichView } from '@/components/SandwichView';
import { NeuralLoader } from '@/components/effects/NeuralLoader';
import { axisCapsFor } from '@/core/decision/axis';
import { fetchMesh, loadConstraints, sandwichLocally, saveConstraints } from '@/core/evidence/meshClient';
import { CriticalFlip } from '@/components/worldline/CriticalFlip';
import { WorldlineBranch, worldlineStateOf } from '@/components/worldline/Worldline';

import type { AxisId, ConstraintProfile, EvidenceMesh } from '@/types/evidence';

/**
 * 双牌对比页（方案 §7.1）。
 *
 * 独立成页的理由：对比是**决策场景**，不是叙事场景。
 * 推演舱的主视觉必须留给「谁在说话」，所以对比放到一个干净的页面上，
 * 让玩家的注意力全部落在「哪条路翻转了、为什么」。
 *
 * 全程零额外请求：网格拉一次（有缓存），之后所有滑杆重算都在本地完成。
 */

function ComparisonScreen() {
  const searchParams = useSearchParams();
  const goalParam = searchParams.get('goal') ?? '';

  const [mesh, setMesh] = React.useState<EvidenceMesh | null>(null);
  const [constraints, setConstraints] = React.useState<ConstraintProfile>(() => loadConstraints());
  const [phase, setPhase] = React.useState<'idle' | 'loading' | 'ready' | 'empty'>('idle');
  const [diagnostics, setDiagnostics] = React.useState<readonly string[]>([]);

  // 约束持久化：下次打开滑杆停在原位
  React.useEffect(() => {
    saveConstraints(constraints);
  }, [constraints]);

  React.useEffect(() => {
    if (goalParam.trim().length === 0) {
      setPhase('empty');
      return;
    }

    const controller = new AbortController();
    setPhase('loading');

    void (async () => {
      const result = await fetchMesh({ goal: goalParam }, { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      if (!result || result.mesh.paths.every((path) => path.sampleSize === 0)) {
        setDiagnostics(result?.diagnostics ?? []);
        setPhase('empty');
        return;
      }
      setMesh(result.mesh);
      setDiagnostics(result.diagnostics);
      setPhase('ready');
    })();

    return () => controller.abort();
  }, [goalParam]);

  // 各轴的最紧需求：来自所有路线的代价画像，用于滑杆上的需求刻度线
  const requirements = React.useMemo(() => {
    if (!mesh) {
      return {} as Partial<Record<AxisId, number>>;
    }
    const out: Partial<Record<AxisId, number>> = {};
    for (const path of mesh.paths) {
      if (path.sampleSize === 0) {
        continue;
      }
      for (const cap of axisCapsFor(path)) {
        const current = out[cap.axis];
        if (current === undefined || cap.requirement > current) {
          out[cap.axis] = cap.requirement;
        }
      }
    }
    return out;
  }, [mesh]);

  // 双牌对比：纯函数本地重算，零请求
  const sandwich = React.useMemo(
    () => (mesh ? sandwichLocally(mesh, constraints) : null),
    [mesh, constraints],
  );

  /**
   * Flip Moment 侦测（v3 §8.3）。
   *
   * 只在**真正发生** `breached → viable` 的那一刻递增 `flipKey`：
   * - 不是「拖到某个值就播」——那会让演出变成噪音；
   * - 反向翻转（viable → breached）**不播**这个演出：世界线断裂
   *   由常态视觉（红色断裂线 + HUD 越线变红）表达，不该每次都来一次高潮。
   *
   * 实现：记住上一次每条路线的裁决 kind，与本次比对。
   * 第一次计算不触发（否则一进页面就播）。
   */
  const [flipKey, setFlipKey] = React.useState(0);
  const prevKindsRef = React.useRef<ReadonlyMap<string, string> | null>(null);

  React.useEffect(() => {
    if (!sandwich) {
      return;
    }

    const current = new Map(
      sandwich.cardA.verdicts.map((item) => [item.pathId, item.verdict.kind] as const),
    );
    const previous = prevKindsRef.current;
    prevKindsRef.current = current;

    if (!previous) {
      return;
    }

    const flipped = [...current.entries()].some(
      ([pathId, kind]) => previous.get(pathId) === 'breached' && kind === 'viable',
    );
    if (flipped) {
      setFlipKey((value) => value + 1);
    }
  }, [sandwich]);

  /** 翻转后的世界线状态：由甲牌（宽裕侧）当前最紧的那条路线决定。 */
  const resultState = React.useMemo(() => {
    if (!sandwich) {
      return 'stable' as const;
    }
    const strongest = sandwich.cardA.verdicts.find((item) => item.verdict.kind === 'viable');
    if (!strongest || strongest.verdict.kind !== 'viable') {
      return 'stable' as const;
    }
    return worldlineStateOf({ kind: 'viable', margin: strongest.verdict.margin });
  }, [sandwich]);

  const flipDone = React.useCallback(() => {
    // 演出结束：把 flipKey 保留（组件内部按 phase 自行收起），无需额外状态
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">双牌对比</p>
          <h1 className="mt-1 text-lg font-bold text-slate-100 sm:text-xl">
            {goalParam.trim().length > 0 ? goalParam : '还没有目标'}
          </h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
            左边是你条件宽裕时的推演，右边是条件紧张时的推演。两张牌的证据完全相同 ——
            差别只来自你自己的处境，所以「换个条件会怎样」是可以直接看的。
          </p>
        </div>
        <Link href="/" className="btn-ghost shrink-0 text-xs">
          返回发令台
        </Link>
      </header>

      {phase === 'loading' ? <NeuralLoader hint="正在检索真实经历并建立证据网格" /> : null}

      {phase === 'empty' ? (
        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-slate-200">这次没有可用的证据网格</h2>
          <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-500">
            {goalParam.trim().length === 0
              ? '请先从发令台输入一句你现在的迷茫，再进入对比。'
              : '没有检索到能归档成前人路径的站内样本。证据网格只在拿到真实内容时才给结论 —— 这是设计，不是失败。'}
          </p>
          {diagnostics.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1">
              {diagnostics.map((item) => (
                <li key={item} className="font-mono text-[10px] text-slate-600">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/play?scenario=ai-dm" className="btn-primary mt-4 inline-flex text-xs">
            先去推演一局
          </Link>
        </section>
      ) : null}

      {phase === 'ready' && mesh && sandwich ? (
        <>
          {/*
            v3 §9.3：对比页的第一视觉语言是**分叉的世界线**，
            而不是左右两张卡片。两条分支从**同一个原点**出发 ——
            这是「同一份证据、唯一变量是你的条件」的视觉表达。

            标签直接复用两张牌自己的名称，避免同一屏里出现两套说法
            （世界线写「宽裕/紧张」而卡片写「余量充足/余量紧张」会让人以为在说两件事）。
          */}
          <WorldlineBranch
            leftState={worldlineStateOf(sandwich.cardA.verdicts[0]?.verdict ?? { kind: 'unknown' })}
            rightState={worldlineStateOf(sandwich.cardB.verdicts[0]?.verdict ?? { kind: 'unknown' })}
            leftLabel={sandwich.cardA.label}
            rightLabel={sandwich.cardB.label}
            className="rounded-2xl border border-white/10 bg-ink-800/40 px-4 pb-4 pt-2"
          />

          <SandwichView
            mesh={mesh}
            sandwich={sandwich}
            constraints={constraints}
            onConstraintsChange={setConstraints}
            renderSlider={({ constraints: current, onChange }) => (
              <AxisSlider constraints={current} onChange={onChange} requirements={requirements} />
            )}
          />
        </>
      ) : null}

      {/* Flip Moment：只在真正发生 breached → viable 时播一次（v3 §8.3） */}
      <CriticalFlip flipKey={flipKey} onDone={flipDone} resultState={resultState} />
    </main>
  );
}

export default function ComparePage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <NeuralLoader hint="正在准备对比" />
        </main>
      }
    >
      <ComparisonScreen />
    </React.Suspense>
  );
}
