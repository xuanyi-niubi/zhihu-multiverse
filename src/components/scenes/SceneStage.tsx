'use client';

import * as React from 'react';

import { getScene } from '@/data/scenes';

import type { SceneDef, SceneId, SceneLayerKind } from '@/types/narrative';

/**
 * 全屏场景舞台。
 *
 * 背景由「色板 + 视差层」驱动：`data/scenes.ts` 定义每个场景有哪几层，
 * 本组件负责把每层画出来并赋予不同的视差系数（远 0.3 / 中 0.7 / 近 1.2）。
 *
 * 性能：鼠标视差用 rAF 节流，只写两个 CSS 变量，单次 repaint；
 * `prefers-reduced-motion` 与触摸设备下完全关闭视差，退化为静态背景。
 */

const VIEW_W = 1200;
const VIEW_H = 700;

interface LayerProps {
  readonly scene: SceneDef;
}

function Layer({
  factor,
  children,
}: {
  readonly factor: number;
  readonly children: React.ReactNode;
}) {
  return (
    <g
      style={{
        transform: `translate3d(calc(var(--px, 0px) * ${factor}), calc(var(--py, 0px) * ${factor}), 0)`,
        transition: 'transform 120ms linear',
      }}
    >
      {children}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 层渲染                                                                      */
/* -------------------------------------------------------------------------- */

function WindowLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.3}>
      {/* 窗外夜空 */}
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={palette.sky} />
      {/* 窗框 */}
      <g stroke={palette.mid} strokeWidth="10" fill={palette.far} opacity="0.9">
        <rect x="120" y="60" width="420" height="300" />
        <rect x="660" y="60" width="420" height="300" />
        <line x1="330" y1="60" x2="330" y2="360" />
        <line x1="870" y1="60" x2="870" y2="360" />
      </g>
      {/* 远处的城市灯点 */}
      <g fill={palette.accent} opacity="0.55">
        {[
          [170, 200], [214, 240], [260, 180], [300, 260], [370, 210], [420, 250], [470, 190],
          [710, 230], [760, 190], [820, 250], [880, 200], [940, 240], [1000, 190], [1040, 250],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="7" height="12" rx="1" />
        ))}
      </g>
    </Layer>
  );
}

function ShelvesLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.7}>
      <g opacity="0.85">
        {[0, 1, 2].map((row) => (
          <g key={row}>
            <rect
              x="40"
              y={300 + row * 120}
              width={VIEW_W - 80}
              height="10"
              fill={palette.mid}
            />
            {Array.from({ length: 22 }).map((_, index) => (
              <rect
                key={index}
                x={60 + index * 50}
                y={300 + row * 120 - 46}
                width={12 + ((index * 7) % 14)}
                height={46}
                rx="2"
                fill={index % 3 === 0 ? palette.accent : palette.near}
                opacity={0.35 + ((index % 4) * 0.12)}
              />
            ))}
          </g>
        ))}
      </g>
    </Layer>
  );
}

function DeskLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={1.2}>
      {/* 桌面 */}
      <rect x="-40" y="560" width={VIEW_W + 80} height="180" fill={palette.near} />
      <rect x="-40" y="560" width={VIEW_W + 80} height="12" fill={palette.mid} />
      {/* 台灯 */}
      <g opacity="0.9">
        <rect x="200" y="500" width="10" height="60" fill={palette.mid} />
        <path d="M180 500 l50 0 l-14 -26 l-22 0 Z" fill={palette.accent} opacity="0.5" />
        <ellipse cx="205" cy="560" rx="70" ry="26" fill={palette.glow} opacity="0.12" />
      </g>
      {/* 翻开的书 */}
      <g transform="translate(700 540)" opacity="0.9">
        <path d="M0 0 l70 -14 l70 14 l-70 10 Z" fill="#F4F7FB" opacity="0.22" />
        <path d="M0 0 l70 -14 l0 24 l-70 10 Z" fill="#F4F7FB" opacity="0.14" />
      </g>
    </Layer>
  );
}

function LightsLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.7}>
      <g opacity="0.5">
        {[0, 1, 2].map((index) => (
          <g key={index}>
            <rect x={160 + index * 340} y="30" width="200" height="8" rx="4" fill={palette.accent} />
            <ellipse cx={260 + index * 340} cy="60" rx="150" ry="60" fill={palette.glow} opacity="0.1" />
          </g>
        ))}
      </g>
    </Layer>
  );
}

function BoardLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.7}>
      <rect x="180" y="90" width="840" height="360" rx="8" fill={palette.far} stroke={palette.mid} strokeWidth="8" />
      <g stroke={palette.accent} strokeWidth="3" opacity="0.35" fill="none">
        <path d="M240 160 h300" />
        <path d="M240 200 h220" />
        <path d="M240 240 h340" />
        <path d="M240 320 h180" />
        <circle cx="760" cy="220" r="60" />
        <path d="M700 300 h180" />
      </g>
    </Layer>
  );
}

function BedLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={1.2}>
      <rect x="60" y="420" width="440" height="220" rx="10" fill={palette.mid} />
      <rect x="60" y="420" width="440" height="34" rx="8" fill={palette.near} />
      <rect x="96" y="380" width="150" height="60" rx="12" fill={palette.near} opacity="0.8" />
      <rect x="700" y="470" width="440" height="170" rx="10" fill={palette.mid} opacity="0.8" />
    </Layer>
  );
}

function CityLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.3}>
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={palette.sky} />
      <g fill={palette.far}>
        {[
          [0, 300, 120, 400], [130, 240, 90, 460], [230, 330, 140, 370],
          [380, 200, 110, 500], [500, 280, 130, 420], [640, 220, 100, 480],
          [750, 320, 150, 380], [910, 250, 120, 450], [1040, 300, 160, 400],
        ].map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
      </g>
      <g fill={palette.accent} opacity="0.4">
        {Array.from({ length: 60 }).map((_, index) => (
          <rect
            key={index}
            x={20 + ((index * 97) % 1160)}
            y={260 + ((index * 53) % 380)}
            width="6"
            height="10"
          />
        ))}
      </g>
    </Layer>
  );
}

function TreesLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.7}>
      <g fill={palette.mid} opacity="0.9">
        {[120, 340, 560, 780, 1000].map((x, index) => (
          <g key={x}>
            <rect x={x - 6} y={380 + (index % 2) * 20} width="12" height={220 - (index % 2) * 20} />
            <ellipse cx={x} cy={350 + (index % 2) * 20} rx="62" ry="54" />
          </g>
        ))}
      </g>
    </Layer>
  );
}

function ScreenLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={1.2}>
      <rect x="470" y="420" width="260" height="160" rx="8" fill={palette.far} stroke={palette.mid} strokeWidth="6" />
      <rect x="486" y="436" width="228" height="128" rx="4" fill={palette.glow} opacity="0.16" />
      <g stroke={palette.accent} strokeWidth="3" opacity="0.5" fill="none">
        <path d="M510 470 h140" />
        <path d="M510 496 h180" />
        <path d="M510 522 h110" />
      </g>
      <rect x="586" y="580" width="28" height="30" fill={palette.mid} />
    </Layer>
  );
}

function RainLayer({ scene }: LayerProps) {
  const { palette } = scene;

  return (
    <Layer factor={0.7}>
      <g stroke={palette.accent} strokeWidth="2" opacity="0.28">
        {Array.from({ length: 90 }).map((_, index) => (
          <line
            key={index}
            x1={((index * 137) % VIEW_W) - 40}
            y1={(index * 83) % VIEW_H}
            x2={(((index * 137) % VIEW_W) - 40) + 18}
            y2={((index * 83) % VIEW_H) + 40}
          />
        ))}
      </g>
    </Layer>
  );
}

const LAYER_RENDERERS: Record<SceneLayerKind, (props: LayerProps) => React.ReactElement | null> = {
  window: WindowLayer,
  shelves: ShelvesLayer,
  desk: DeskLayer,
  lights: LightsLayer,
  board: BoardLayer,
  bed: BedLayer,
  city: CityLayer,
  trees: TreesLayer,
  screen: ScreenLayer,
  rain: RainLayer,
};

/* -------------------------------------------------------------------------- */
/* 主体                                                                        */
/* -------------------------------------------------------------------------- */

export interface SceneStageProps {
  readonly sceneId: SceneId;
  readonly className?: string;
}

export function SceneStage({ sceneId, className }: SceneStageProps) {
  const scene = getScene(sceneId);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const [parallaxEnabled, setParallaxEnabled] = React.useState(false);

  React.useEffect(() => {
    const hoverCapable = window.matchMedia('(hover: hover)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setParallaxEnabled(hoverCapable && !reduced);
  }, []);

  React.useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!parallaxEnabled) {
        return;
      }

      pointerRef.current = { x: event.clientX, y: event.clientY };

      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;

        const container = containerRef.current;
        const pointer = pointerRef.current;

        if (!container || !pointer) {
          return;
        }

        const rect = container.getBoundingClientRect();
        const nx = (pointer.x - rect.left) / rect.width - 0.5;
        const ny = (pointer.y - rect.top) / rect.height - 0.5;

        container.style.setProperty('--px', `${(nx * 18).toFixed(2)}px`);
        container.style.setProperty('--py', `${(ny * 14).toFixed(2)}px`);
      });
    },
    [parallaxEnabled],
  );

  const resetParallax = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.style.setProperty('--px', '0px');
    container.style.setProperty('--py', '0px');
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetParallax}
      className={['absolute inset-0 overflow-hidden', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >
        {scene.layers.map((kind) => {
          const Renderer = LAYER_RENDERERS[kind];
          return <Renderer key={kind} scene={scene} />;
        })}
      </svg>

      {/* 暗角与扫描线，统一氛围 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_20%,transparent_35%,rgba(5,7,13,0.82)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-scanline opacity-[0.1]" />
    </div>
  );
}

export default SceneStage;
