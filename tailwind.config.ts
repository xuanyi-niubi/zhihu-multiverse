import type { Config } from 'tailwindcss';

/**
 * 知乎平行宇宙 · 设计令牌
 *
 * 视觉基线：暗黑赛博 + 知乎蓝（#0084FF），遗物用琥珀金区分主动/稀有品质。
 * 所有动效都在 globals.css 的 prefers-reduced-motion 分支里被强制降级。
 */
const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/core/**/*.{ts,tsx}',
    './src/data/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
    './src/types/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#07080C',
          800: '#0B0D14',
          700: '#10141F',
          600: '#131824',
          500: '#171C27',
        },
        zhihu: {
          50: '#EAF5FF',
          100: '#CFE8FF',
          200: '#A9CDFF',
          300: '#7DB4FF',
          400: '#5C9FFF',
          500: '#3D8BFF',
          600: '#2A6BEB',
          700: '#1C5FD6',
        },
        relic: {
          gold: '#F5B841',
          danger: '#FF4D6D',
          jade: '#3DD6A0',
        },
        /**
         * 平行人生档案馆（报告 §2）—— 新主链专用语义色。
         *
         * 三种强调色各只承担一件事，避免同一屏出现第四种：
         * `archive` 深夜基底 / `unlock` 青绿=新行动 / `counter` 低饱和琥珀=反例。
         */
        archive: {
          950: '#07080C',
          900: '#0B0D14',
          850: '#10141F',
          800: '#131824',
          /* 文本层级：与画布提案的正文/次要/未知一致 */
          600: '#5F6C80',
          400: '#667284',
          300: '#8C97A8',
          200: '#A3AEC0',
          100: '#EEF1F6',
        },
        unlock: {
          DEFAULT: '#6FE3D8',
          soft: '#9AEADE',
          deep: '#2E7D72',
        },
        counter: {
          DEFAULT: '#C9A45E',
          soft: '#DCC08A',
          deep: '#8A6E3C',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'sans-serif',
        ],
        serif: ['"Noto Serif SC"', '"Songti SC"', 'Georgia', 'serif'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(0,132,255,0.25), 0 24px 60px -28px rgba(0,132,255,0.65)',
        relic: '0 18px 40px -16px rgba(245,184,65,0.5)',
        'inner-line': 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        'grid-fate':
          'linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)',
        'radial-halo':
          'radial-gradient(60% 55% at 50% 0%, rgba(0,132,255,0.20) 0%, rgba(0,132,255,0) 72%)',
        'radial-gold':
          'radial-gradient(45% 45% at 50% 100%, rgba(245,184,65,0.14) 0%, rgba(245,184,65,0) 70%)',
        scanline:
          'repeating-linear-gradient(to bottom, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)',
        'danger-flash':
          'radial-gradient(70% 70% at 50% 50%, rgba(255,77,109,0.28) 0%, rgba(255,77,109,0) 75%)',
      },
      backgroundSize: {
        'grid-fate': '32px 32px',
      },
      /**
       * Tailwind 默认透明度刻度是 0–100 每 5 一档，`/12`、`/8`、`/18` 这类
       * 中间值不存在。这里补齐用到的档位，让 `border-white/12` 在类名与
       * `@apply` 中都合法，避免散落改成 arbitrary value。
       */
      opacity: {
        8: '0.08',
        12: '0.12',
        18: '0.18',
        22: '0.22',
      },
      keyframes: {
        // v3 §8.3 Flip Moment 的三段演出（刻意只加这三个，其余用普通 transition）
        'wl-grow': {
          '0%': { opacity: '0', transform: 'scaleX(0.04)' },
          '60%': { opacity: '1', transform: 'scaleX(1)' },
          '100%': { opacity: '1', transform: 'scaleX(1)' },
        },
        'wl-shatter': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)', letterSpacing: '0.3em' },
          '35%': { opacity: '0.9', transform: 'translateY(-2px) scale(1.06)' },
          '100%': { opacity: '0', transform: 'translateY(10px) scale(1.18)', letterSpacing: '0.5em' },
        },
        'wl-settle': {
          '0%': { opacity: '0.4', transform: 'scaleX(1.06)' },
          '100%': { opacity: '1', transform: 'scaleX(1)' },
        },
        'caret-blink': {
          '0%, 45%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-24' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'halo-pulse': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.8' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '92%': { opacity: '0.88' },
          '94%': { opacity: '0.42' },
          '96%': { opacity: '0.9' },
        },
        'ping-slow': {
          '0%': { transform: 'scale(1)', opacity: '0.5' },
          '70%, 100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        /* ---- 游戏演出用 ---- */
        glitch: {
          '0%, 100%': { transform: 'translate(0, 0) skewX(0deg)', opacity: '1' },
          '20%': { transform: 'translate(-3px, 1px) skewX(-4deg)', opacity: '0.85' },
          '40%': { transform: 'translate(4px, -2px) skewX(3deg)', opacity: '0.95' },
          '60%': { transform: 'translate(-2px, 2px) skewX(2deg)', opacity: '0.8' },
          '80%': { transform: 'translate(3px, 1px) skewX(-3deg)', opacity: '1' },
        },
        heartbeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '14%': { transform: 'scale(1.07)' },
          '28%': { transform: 'scale(1)' },
          '42%': { transform: 'scale(1.05)' },
          '70%': { transform: 'scale(1)' },
        },
        'alert-pulse': {
          '0%, 100%': { opacity: '0' },
          '50%': { opacity: '0.6' },
        },
        'dice-tumble': {
          '0%': { transform: 'rotate(-9deg) scale(0.95)' },
          '50%': { transform: 'rotate(9deg) scale(1.05)' },
          '100%': { transform: 'rotate(-9deg) scale(0.95)' },
        },
        'scan-sweep': {
          '0%': { transform: 'translateX(-130%)' },
          '100%': { transform: 'translateX(230%)' },
        },
        'stamp-in': {
          '0%': { transform: 'scale(2.6) rotate(-18deg)', opacity: '0' },
          '60%': { transform: 'scale(0.93) rotate(-5deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(-8deg)', opacity: '1' },
        },
        'bounce-in': {
          '0%': { transform: 'scale(0.88)', opacity: '0' },
          '70%': { transform: 'scale(1.03)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'float-tilt': {
          '0%, 100%': { transform: 'translateY(0) rotate(-2deg)' },
          '50%': { transform: 'translateY(-8px) rotate(2deg)' },
        },
        /* ---- 叙事舞台用 ---- */
        'bar-hit': {
          '0%': { transform: 'skewX(-14deg) translateX(0)' },
          '25%': { transform: 'skewX(-14deg) translateX(-4px)' },
          '50%': { transform: 'skewX(-14deg) translateX(3px)' },
          '75%': { transform: 'skewX(-14deg) translateX(-2px)' },
          '100%': { transform: 'skewX(-14deg) translateX(0)' },
        },
        'float-up': {
          '0%': { transform: 'translateY(0) scale(0.9)', opacity: '0' },
          '18%': { transform: 'translateY(-6px) scale(1.06)', opacity: '1' },
          '100%': { transform: 'translateY(-58px) scale(1)', opacity: '0' },
        },
        'act-in': {
          '0%': { opacity: '0', transform: 'translateY(14px)', filter: 'blur(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'text-unstable': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-0.6px)' },
          '40%': { transform: 'translateX(0.8px)' },
          '60%': { transform: 'translateX(-0.4px)' },
          '80%': { transform: 'translateX(0.5px)' },
        },
        breath: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-7px) scale(1.012)' },
        },
        'portrait-in': {
          '0%': { opacity: '0', transform: 'translateY(26px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        drift: {
          '0%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(-1.5%, -1%, 0)' },
          '100%': { transform: 'translate3d(0, 0, 0)' },
        },
        'flash-red': {
          '0%': { opacity: '0' },
          '18%': { opacity: '0.75' },
          '100%': { opacity: '0' },
        },
        'flash-white': {
          '0%': { opacity: '0' },
          '12%': { opacity: '0.92' },
          '100%': { opacity: '0' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'mask-reveal': {
          '0%': { clipPath: 'inset(0 100% 0 0)' },
          '100%': { clipPath: 'inset(0 0 0 0)' },
        },
      },
      animation: {
        'wl-grow': 'wl-grow 0.8s cubic-bezier(0.22, 1, 0.36, 1) both',
        'wl-shatter': 'wl-shatter 0.62s ease-out both',
        'wl-settle': 'wl-settle 0.5s ease-out both',
        'caret-blink': 'caret-blink 1s step-end infinite',
        'dash-flow': 'dash-flow 1.1s linear infinite',
        'float-slow': 'float-slow 6s ease-in-out infinite',
        'halo-pulse': 'halo-pulse 4.5s ease-in-out infinite',
        'rise-in': 'rise-in 0.45s ease-out both',
        flicker: 'flicker 7s linear infinite',
        'ping-slow': 'ping-slow 2.4s cubic-bezier(0, 0, 0.2, 1) infinite',
        glitch: 'glitch 0.6s steps(2, end) infinite',
        heartbeat: 'heartbeat 1.3s ease-in-out infinite',
        'alert-pulse': 'alert-pulse 1.6s ease-in-out infinite',
        'dice-tumble': 'dice-tumble 0.18s ease-in-out infinite',
        'scan-sweep': 'scan-sweep 1.4s ease-in-out infinite',
        'stamp-in': 'stamp-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bounce-in': 'bounce-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'float-tilt': 'float-tilt 5s ease-in-out infinite',
        'bar-hit': 'bar-hit 320ms ease-out',
        'float-up': 'float-up 1.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'act-in': 'act-in 0.48s cubic-bezier(0.22, 1, 0.36, 1) both',
        'text-unstable': 'text-unstable 2.6s ease-in-out infinite',
        breath: 'breath 3.2s ease-in-out infinite',
        'portrait-in': 'portrait-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both',
        drift: 'drift 18s ease-in-out infinite',
        'flash-red': 'flash-red 0.5s ease-out both',
        'flash-white': 'flash-white 0.32s ease-out both',
        'slide-in-right': 'slide-in-right 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'mask-reveal': 'mask-reveal 1.1s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
