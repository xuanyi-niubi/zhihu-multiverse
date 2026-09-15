import {
  DESKTOP_STARS,
  MOBILE_STARS,
  celestialTrackState,
  type CelestialScene,
  type CelestialTrackState,
} from '@/features/visual/celestial';

export interface CelestialBackdropProps {
  readonly scene: CelestialScene;
  readonly tracks?: readonly CelestialTrackState[];
  readonly className?: string;
}

const TRACK_POSITION: Readonly<Record<CelestialTrackState['id'], { readonly cx: number; readonly cy: number }>> = {
  similar: { cx: 24, cy: 37 },
  alternative: { cx: 72, cy: 28 },
  counter: { cx: 79, cy: 71 },
};

export function CelestialBackdrop({ scene, tracks = [], className = '' }: CelestialBackdropProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={['sil-celestial', `sil-celestial--${scene}`, className].filter(Boolean).join(' ')}
      data-scene={scene}
    >
      <g className="sil-celestial__nebula">
        <ellipse cx="24" cy="31" rx="42" ry="30" />
        <ellipse cx="82" cy="74" rx="36" ry="28" />
      </g>

      <g className="sil-celestial__stars sil-celestial__stars--mobile">
        {MOBILE_STARS.map((star, index) => (
          <circle key={`m-${index}`} cx={star.x} cy={star.y} r={star.radius} opacity={star.opacity} />
        ))}
      </g>
      <g className="sil-celestial__stars sil-celestial__stars--desktop">
        {DESKTOP_STARS.map((star, index) => (
          <circle key={`d-${index}`} cx={star.x} cy={star.y} r={star.radius} opacity={star.opacity} />
        ))}
      </g>

      <g className="sil-celestial__orbits">
        <ellipse cx="50" cy="50" rx="46" ry="21" transform="rotate(-12 50 50)" />
        <ellipse cx="50" cy="50" rx="36" ry="42" transform="rotate(31 50 50)" />
        <ellipse className="sil-celestial__orbit--desktop" cx="50" cy="50" rx="49" ry="34" transform="rotate(18 50 50)" />
      </g>

      <g className="sil-celestial__planets">
        <circle className="sil-celestial__planet sil-celestial__planet--primary" cx="18" cy="75" r="7.5" />
        <circle className="sil-celestial__planet-shade" cx="15.5" cy="72.5" r="5.2" />
        <circle className="sil-celestial__planet sil-celestial__planet--secondary" cx="82" cy="21" r="3.1" />
        <circle className="sil-celestial__planet sil-celestial__planet--desktop" cx="88" cy="78" r="2.2" />
      </g>

      {tracks.length > 0 ? (
        <g className="sil-celestial__tracks">
          {tracks.map((track) => {
            const point = TRACK_POSITION[track.id];
            return (
              <circle
                key={track.id}
                className={`sil-celestial__track sil-celestial__track--${track.id}`}
                data-state={celestialTrackState(track.found)}
                cx={point.cx}
                cy={point.cy}
                r="1.8"
              />
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}

export default CelestialBackdrop;
