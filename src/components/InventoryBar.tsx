'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import type {
  OwnedZhihuRelic,
  RelicInventory,
  RelicKind,
  RelicStackRule,
  TargetStat,
  ZhihuRelicEffect,
} from '@/types/game';

/* -------------------------------------------------------------------------- */
/* 常量与纯函数                                                                */
/* -------------------------------------------------------------------------- */

/** 架构师规范：遗物栏固定 3 槽位（RelicInventory 定长 tuple）。 */
const SLOT_COUNT = 3;

/** 浮层 id 前缀，用于 aria-describedby 关联。 */
const TOOLTIP_ID_PREFIX = 'zhihu-relic-tooltip';

/**
 * 同构 layout effect。
 *
 * Next.js App Router 会对客户端组件做首屏 SSR，此时 useLayoutEffect 会在服务端
 * 触发 "useLayoutEffect does nothing on the server" 告警；服务端降级为 useEffect。
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

const STAT_LABEL: Record<TargetStat, string> = {
  san: 'SAN 心智',
  skill: '专业力',
  bond: '社区羁绊',
};

const KIND_LABEL: Record<RelicKind, string> = {
  passive: '被动',
  active: '主动',
};

const STACK_RULE_LABEL: Record<RelicStackRule, string> = {
  'additive-capped': '同类相加后封顶',
  'highest-only': '同类只取最高值',
  unique: '同名效果仅生效一次',
  'once-per-check': '每次检定最多触发一次',
};

/** 轻量 className 组合器，避免为一个组件引入 clsx 依赖。 */
function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/**
 * 运行时防御性归一化。
 *
 * 类型层已由 RelicInventory 定长 tuple 保证 3 槽位，但存档、接口或 localStorage
 * 反序列化可能带来长度异常的数据；这里统一补齐/截断为 3 槽，避免 UI 渲染错位。
 */
function normalizeInventory(inventory: RelicInventory): RelicInventory {
  const slots: Array<OwnedZhihuRelic | null> = [];

  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const candidate = (inventory as ReadonlyArray<OwnedZhihuRelic | null | undefined>)[index];
    slots.push(candidate ?? null);
  }

  if (process.env.NODE_ENV !== 'production' && inventory.length !== SLOT_COUNT) {
    // eslint-disable-next-line no-console
    console.warn(
      `[InventoryBar] 规范要求 ${SLOT_COUNT} 个槽位，实际收到 ${inventory.length} 个，已按规范归一化。`,
    );
  }

  return slots as unknown as RelicInventory;
}

/* -------------------------------------------------------------------------- */
/* 效果文案渲染                                                                */
/* -------------------------------------------------------------------------- */

type EffectTone = 'blue' | 'rose' | 'amber';

interface EffectDescriptor {
  effectId: string;
  typeLabel: string;
  headline: string;
  detail: string;
  tone: EffectTone;
}

/**
 * 把判别联合 ZhihuRelicEffect 翻译成展示文案。
 * 这里只做展示，不参与任何数值计算，保证与 D20 引擎职责分离。
 */
function describeEffect(effect: ZhihuRelicEffect): EffectDescriptor {
  if (effect.type === 'check-modifier') {
    return {
      effectId: effect.effectId,
      typeLabel: '常驻检定',
      headline: `${STAT_LABEL[effect.targetStat]}检定 ${formatSigned(effect.modifier)}`,
      detail: `叠加规则：${STACK_RULE_LABEL[effect.stackRule]}`,
      tone: 'blue',
    };
  }

  if (effect.type === 'san-damage-reduction') {
    return {
      effectId: effect.effectId,
      typeLabel: '心智护盾',
      headline: `SAN 损失减免 ${formatPercent(effect.ratio)}`,
      detail: `聚合上限 ${formatPercent(effect.aggregateCap)}，重复遗物不可突破`,
      tone: 'rose',
    };
  }

  return {
    effectId: effect.effectId,
    typeLabel: '一次性锦囊',
    headline: effect.targetStat
      ? `下一次${STAT_LABEL[effect.targetStat]}检定 ${formatSigned(effect.modifier)}`
      : `下一次任意检定 ${formatSigned(effect.modifier)}`,
    detail: `剩余充能 ${effect.charges} 次，触发后立即消耗`,
    tone: 'amber',
  };
}

const TONE_STYLE: Record<EffectTone, { badge: string; headline: string; bar: string }> = {
  blue: {
    badge: 'bg-[#0084FF]/15 text-[#7CC0FF] ring-1 ring-inset ring-[#0084FF]/30',
    headline: 'text-[#9CCEFF]',
    bar: 'bg-[#0084FF]',
  },
  rose: {
    badge: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
    headline: 'text-rose-200',
    bar: 'bg-rose-400',
  },
  amber: {
    badge: 'bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
    headline: 'text-amber-200',
    bar: 'bg-amber-400',
  },
};

/* -------------------------------------------------------------------------- */
/* 浮层定位                                                                    */
/* -------------------------------------------------------------------------- */

interface TooltipPosition {
  top: number;
  left: number;
  placement: 'top' | 'bottom';
  /** 箭头中心相对浮层左边缘的偏移量。 */
  arrowOffset: number;
}

/**
 * 基于视口的浮层定位：优先显示在槽位上方，空间不足时翻转到下方，
 * 并在水平方向夹紧到视口内，避免窄屏溢出。
 *
 * 浮层通过 Portal 渲染到 body，因此必须监听 scroll（capture）与 resize 重新测量。
 */
function useTooltipPosition(
  open: boolean,
  anchor: HTMLElement | null,
  tooltip: HTMLElement | null,
): TooltipPosition | null {
  const [position, setPosition] = React.useState<TooltipPosition | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!open || !anchor || !tooltip) {
      setPosition(null);
      return;
    }

    const measure = () => {
      const GAP = 12;
      const MARGIN = 8;

      const rect = anchor.getBoundingClientRect();
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;

      const spaceAbove = rect.top - MARGIN;
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;

      const placement: 'top' | 'bottom' =
        spaceAbove >= height + GAP || spaceAbove >= spaceBelow ? 'top' : 'bottom';

      const top = placement === 'top' ? rect.top - height - GAP : rect.bottom + GAP;

      const anchorCenter = rect.left + rect.width / 2;
      const left = Math.min(
        Math.max(MARGIN, anchorCenter - width / 2),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      );

      const arrowOffset = Math.min(Math.max(18, anchorCenter - left), Math.max(18, width - 18));

      setPosition({ top, left, placement, arrowOffset });
    };

    measure();

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchor, tooltip]);

  return position;
}

/* -------------------------------------------------------------------------- */
/* 悬停浮层                                                                    */
/* -------------------------------------------------------------------------- */

interface RelicTooltipProps {
  owned: OwnedZhihuRelic;
  /** 首次测量完成前为 null，此时浮层保持不可见以避免闪烁。 */
  position: TooltipPosition | null;
  tooltipId: string;
  tooltipRef: (node: HTMLDivElement | null) => void;
  disabled: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onUse?: () => void;
}

function RelicTooltip({
  owned,
  position,
  tooltipId,
  tooltipRef,
  disabled,
  onPointerEnter,
  onPointerLeave,
  onUse,
}: RelicTooltipProps) {
  const { relic } = owned;
  const descriptors = relic.effects.map(describeEffect);
  const isActive = relic.kind === 'active';
  const canUse = isActive && !owned.isConsumed && Boolean(onUse) && !disabled;

  return (
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        top: position ? position.top : -9999,
        left: position ? position.left : -9999,
      }}
      className={cx(
        'pointer-events-auto fixed z-[60] w-[340px] max-w-[calc(100vw-16px)] rounded-2xl border border-white/10 bg-[#0B1220]/98 p-4 text-left shadow-[0_28px_70px_-24px_rgba(0,0,0,0.95)] backdrop-blur-xl transition-opacity duration-150 ease-out',
        position ? 'opacity-100' : 'opacity-0',
      )}
    >
      {position ? (
        <span
          aria-hidden="true"
          style={{ left: position.arrowOffset - 6 }}
          className={cx(
            'absolute h-3 w-3 rotate-45 border-white/10 bg-[#0B1220]',
            position.placement === 'top' ? '-bottom-1.5 border-b border-r' : '-top-1.5 border-l border-t',
          )}
        />
      ) : null}

      {/* 标题区：名称 + 主动/被动标签 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-white">{relic.name}</h4>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            来源：{relic.source.author} · {relic.source.title}
          </p>
        </div>
        <span
          className={cx(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            isActive
              ? 'bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30'
              : 'bg-[#0084FF]/15 text-[#7CC0FF] ring-1 ring-inset ring-[#0084FF]/30',
          )}
        >
          {KIND_LABEL[relic.kind]}
        </span>
      </div>

      {/* 知乎原声金句 */}
      <blockquote className="mt-3 border-l-2 border-[#0084FF]/50 pl-3 text-xs leading-relaxed text-slate-300">
        {relic.quote}
      </blockquote>

      {/* 效果列表 */}
      <ul className="mt-3 space-y-2">
        {descriptors.map((descriptor) => {
          const tone = TONE_STYLE[descriptor.tone];

          return (
            <li
              key={descriptor.effectId}
              className="relative rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 pl-4"
            >
              <span
                aria-hidden="true"
                className={cx('absolute bottom-2 left-0 top-2 w-0.5 rounded-full', tone.bar)}
              />
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cx(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    tone.badge,
                  )}
                >
                  {descriptor.typeLabel}
                </span>
                <span className={cx('text-xs font-semibold', tone.headline)}>
                  {descriptor.headline}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {descriptor.detail}
              </p>
            </li>
          );
        })}
      </ul>

      {/* 元数据 */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
          获得回合
          <span className="ml-1 font-medium text-slate-200">第 {owned.acquiredAtTurn} 回合</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
          {isActive ? (
            <>
              剩余充能
              <span className="ml-1 font-medium text-slate-200">
                {owned.remainingCharges ?? 0} / {owned.maxCharges ?? 0}
              </span>
            </>
          ) : (
            <>
              生效方式
              <span className="ml-1 font-medium text-slate-200">常驻被动</span>
            </>
          )}
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <a
          href={relic.source.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0084FF] transition-colors duration-150 ease-out hover:text-[#5EB2FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0084FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1220]"
        >
          查看知乎原文
          <span aria-hidden="true">↗</span>
        </a>

        {isActive ? (
          owned.isConsumed ? (
            <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-500">
              已耗尽
            </span>
          ) : (
            <button
              type="button"
              onClick={onUse}
              disabled={!canUse}
              className={cx(
                'rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0084FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1220]',
                canUse
                  ? 'bg-[#0084FF] text-white hover:bg-[#0073DE] active:scale-[0.97]'
                  : 'cursor-not-allowed bg-white/10 text-slate-500',
              )}
            >
              使用遗物
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 单个槽位                                                                    */
/* -------------------------------------------------------------------------- */

interface RelicSlotProps {
  index: number;
  owned: OwnedZhihuRelic | null;
  isOpen: boolean;
  isPinned: boolean;
  disabled: boolean;
  registerAnchor: (index: number, node: HTMLLIElement | null) => void;
  onPointerEnter: (index: number) => void;
  onPointerLeave: (index: number) => void;
  onFocus: (index: number) => void;
  onBlur: (index: number) => void;
  onTogglePin: (index: number) => void;
}

function RelicSlot({
  index,
  owned,
  isOpen,
  isPinned,
  disabled,
  registerAnchor,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onTogglePin,
}: RelicSlotProps) {
  const slotLabel = String(index + 1).padStart(2, '0');

  if (!owned) {
    return (
      <li ref={(node) => registerAnchor(index, node)} className="list-none">
        <div className="flex h-[180px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/12 bg-white/[0.02]">
          <span className="text-[11px] font-semibold tracking-[0.35em] text-slate-600">
            {slotLabel}
          </span>
          <span className="text-xs text-slate-500">空槽位</span>
          <span className="px-3 text-center text-[10px] leading-relaxed text-slate-600">
            检定成功或遭遇奇遇可获得遗物
          </span>
        </div>
      </li>
    );
  }

  const { relic } = owned;
  const isActive = relic.kind === 'active';
  const tooltipId = `${TOOLTIP_ID_PREFIX}-${relic.id}`;

  return (
    <li
      ref={(node) => registerAnchor(index, node)}
      onPointerEnter={() => onPointerEnter(index)}
      onPointerLeave={() => onPointerLeave(index)}
      onFocus={() => onFocus(index)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextTarget)) {
          onBlur(index);
        }
      }}
      className="relative list-none"
    >
      <button
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-pressed={isPinned}
        aria-label={`${relic.name}，${KIND_LABEL[relic.kind]}遗物${
          owned.isConsumed ? '，已消耗' : ''
        }`}
        onClick={() => onTogglePin(index)}
        className={cx(
          'group relative flex h-[180px] w-full flex-col overflow-hidden rounded-2xl border p-3 text-left transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0084FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B14]',
          owned.isConsumed
            ? 'border-white/10 bg-[#0C1322] opacity-55 saturate-0'
            : isActive
              ? 'border-amber-400/35 bg-gradient-to-b from-[#1C1708] to-[#0C1322] hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-[0_18px_40px_-16px_rgba(245,184,65,0.5)]'
              : 'border-[#0084FF]/35 bg-gradient-to-b from-[#0B1B33] to-[#0C1322] hover:-translate-y-1 hover:border-[#0084FF]/70 hover:shadow-[0_18px_40px_-16px_rgba(0,132,255,0.5)]',
          isOpen && !owned.isConsumed ? '-translate-y-1 border-white/25' : '',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {/* 顶部光晕 */}
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute inset-x-0 top-0 h-16 opacity-70',
            isActive
              ? 'bg-gradient-to-b from-amber-400/12 to-transparent'
              : 'bg-gradient-to-b from-[#0084FF]/14 to-transparent',
          )}
        />

        {/* 类型 + 充能 */}
        <span className="relative flex items-center justify-between gap-2">
          <span
            className={cx(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              isActive
                ? 'bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30'
                : 'bg-[#0084FF]/15 text-[#7CC0FF] ring-1 ring-inset ring-[#0084FF]/30',
            )}
          >
            {KIND_LABEL[relic.kind]}
          </span>
          {isActive ? (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-300">
              充能 {owned.remainingCharges ?? 0}/{owned.maxCharges ?? 0}
            </span>
          ) : (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-400">
              常驻
            </span>
          )}
        </span>

        {/* 名称 */}
        <span className="relative mt-2.5 line-clamp-2 text-sm font-semibold leading-snug text-white">
          {relic.name}
        </span>

        {/* 金句 */}
        <span className="relative mt-1.5 line-clamp-2 text-[11px] italic leading-relaxed text-slate-400">
          「{relic.quote}」
        </span>

        {/* 底部来源与回合 */}
        <span className="relative mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="truncate text-[10px] text-slate-500">@{relic.source.author}</span>
          <span className="shrink-0 text-[10px] font-medium text-slate-600">
            T{owned.acquiredAtTurn}
          </span>
        </span>

        {/* 已消耗遮罩 */}
        {owned.isConsumed ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0px,rgba(255,255,255,0.05)_2px,transparent_2px,transparent_8px)]"
          >
            <span className="-rotate-12 rounded-md border border-white/15 bg-black/50 px-3 py-1 text-[11px] font-semibold tracking-widest text-slate-300">
              已消耗
            </span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* 装备栏                                                                      */
/* -------------------------------------------------------------------------- */

export interface InventoryBarProps {
  /**
   * 架构师规范中的固定 3 槽位遗物栏。
   * 组件为纯展示层，只读取该快照，绝不直接修改它。
   */
  inventory: RelicInventory;

  /**
   * 主动遗物被确认使用时触发。
   * 仅向上传递 relicId；由上层按 RelicUseRequest 构造完整请求并处理
   * RelicInventoryTransition，避免展示组件持有业务状态。
   */
  onUseRelic?: (relicId: string) => void;

  /** 禁用全部交互（例如 D20 结算中、动画播放中）。 */
  disabled?: boolean;

  /** 区块标题。 */
  title?: string;

  /** 追加到根节点的类名，便于在布局中控制宽度与间距。 */
  className?: string;
}

export function InventoryBar({
  inventory,
  onUseRelic,
  disabled = false,
  title = '知乎遗物 · 3 槽位',
  className,
}: InventoryBarProps) {
  const slots = React.useMemo(() => normalizeInventory(inventory), [inventory]);

  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = React.useState<number | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const [tooltipEl, setTooltipEl] = React.useState<HTMLDivElement | null>(null);

  const anchorRefs = React.useRef<Array<HTMLLIElement | null>>([null, null, null]);
  const closeTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const registerAnchor = React.useCallback((index: number, node: HTMLLIElement | null) => {
    anchorRefs.current[index] = node;
  }, []);

  const openSlot = React.useCallback(
    (index: number) => {
      cancelClose();
      setOpenIndex(index);
    },
    [cancelClose],
  );

  const scheduleClose = React.useCallback(
    (index: number) => {
      if (pinnedIndex === index) {
        return;
      }

      cancelClose();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setOpenIndex((current) => (current === index ? null : current));
      }, 140);
    },
    [cancelClose, pinnedIndex],
  );

  const togglePin = React.useCallback(
    (index: number) => {
      cancelClose();
      setPinnedIndex((current) => (current === index ? null : index));
      setOpenIndex(index);
    },
    [cancelClose],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') {
        return;
      }

      cancelClose();
      setPinnedIndex(null);
      setOpenIndex(null);
    },
    [cancelClose],
  );

  const activeIndex = openIndex !== null && slots[openIndex] ? openIndex : null;
  const activeOwned = activeIndex !== null ? slots[activeIndex] : null;
  const anchor = activeIndex !== null ? anchorRefs.current[activeIndex] : null;

  const position = useTooltipPosition(activeOwned !== null, anchor, tooltipEl);

  const equippedCount = slots.filter((slot) => slot !== null).length;

  return (
    <section
      aria-label={title}
      onKeyDown={handleKeyDown}
      className={cx('w-full', className)}
    >
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[#0084FF]" />
          <h3 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-slate-400">
          已装备 <span className="font-semibold text-[#7CC0FF]">{equippedCount}</span> /{' '}
          {SLOT_COUNT}
        </span>
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:gap-3">
        {slots.map((owned, index) => (
          <RelicSlot
            key={owned ? owned.relic.id : `empty-slot-${index}`}
            index={index}
            owned={owned}
            isOpen={activeIndex === index}
            isPinned={pinnedIndex === index}
            disabled={disabled}
            registerAnchor={registerAnchor}
            onPointerEnter={openSlot}
            onPointerLeave={scheduleClose}
            onFocus={openSlot}
            onBlur={scheduleClose}
            onTogglePin={togglePin}
          />
        ))}
      </ul>

      {mounted && activeOwned
        ? createPortal(
            <RelicTooltip
              owned={activeOwned}
              position={position}
              tooltipId={`${TOOLTIP_ID_PREFIX}-${activeOwned.relic.id}`}
              tooltipRef={setTooltipEl}
              disabled={disabled}
              onPointerEnter={cancelClose}
              onPointerLeave={() => {
                if (activeIndex !== null) {
                  scheduleClose(activeIndex);
                }
              }}
              onUse={onUseRelic ? () => onUseRelic(activeOwned.relic.id) : undefined}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

export default InventoryBar;
