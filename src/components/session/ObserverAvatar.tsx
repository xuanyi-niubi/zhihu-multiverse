'use client';

import * as React from 'react';

export interface ObserverAvatarProps {
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly className?: string;
  readonly imageClassName?: string;
  readonly style?: React.CSSProperties;
}

/** 同源代理失败时让用户浏览器直连知乎 CDN；两条路都失败仍显示昵称首字。 */
export function ObserverAvatar({
  name,
  avatarUrl,
  className = '',
  imageClassName = '',
  style,
}: ObserverAvatarProps) {
  const [source, setSource] = React.useState(avatarUrl ? '/api/oauth/avatar' : null);

  React.useEffect(() => {
    setSource(avatarUrl ? '/api/oauth/avatar' : null);
  }, [avatarUrl]);

  return (
    <span
      className={['relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={source ? `${name}的知乎头像` : `${name}的文字头像`}
      style={style}
    >
      <span aria-hidden="true" className="font-semibold">
        {name.trim().charAt(0) || '知'}
      </span>
      {source ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          className={['absolute inset-0 h-full w-full object-cover', imageClassName].filter(Boolean).join(' ')}
          onError={() => {
            if (source === '/api/oauth/avatar' && avatarUrl) {
              setSource(avatarUrl);
            } else {
              setSource(null);
            }
          }}
        />
      ) : null}
    </span>
  );
}

export default ObserverAvatar;
