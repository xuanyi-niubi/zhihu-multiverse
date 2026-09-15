export const CELESTIAL_SCENES = [
  'observatory',
  'retrieving',
  'simulation',
  'returning',
] as const;

export type CelestialScene = (typeof CELESTIAL_SCENES)[number];

export interface CelestialStar {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly opacity: number;
}

export interface CelestialTrackState {
  readonly id: 'similar' | 'alternative' | 'counter';
  readonly found: number | null;
}

export type CelestialTrackVisualState = 'pending' | 'hit' | 'empty';

function stars(count: number, xStep: number, yStep: number): readonly CelestialStar[] {
  return Array.from({ length: count }, (_, index) => ({
    x: (7 + index * xStep) % 97,
    y: (11 + index * yStep) % 89,
    radius: 0.35 + (index % 4) * 0.16,
    opacity: 0.22 + (index % 5) * 0.1,
  }));
}

/** 固定星位：刷新不会换一片天空，也不需要运行时随机数。 */
export const MOBILE_STARS = stars(36, 17, 29);
export const DESKTOP_STARS = stars(72, 23, 31);

export function celestialTrackState(found: number | null): CelestialTrackVisualState {
  if (found === null) return 'pending';
  return found > 0 ? 'hit' : 'empty';
}
