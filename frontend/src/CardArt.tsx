import { useEffect, useState } from 'react';
import { getCardArt, type CardArt as CardArtData } from './scryfall';

// `variant="crop"` renders the tight art_crop (no border/text) for compact
// spaces (card tiles, deck rows); `variant="full"` renders the full card
// face for hover previews / detail modals. Fails silently to a blank/muted
// box rather than blocking the surrounding UI — art is a nice-to-have, the
// game is fully playable from Forge's data alone.
export function CardArt({
  name,
  variant,
  className,
}: {
  name: string;
  variant: 'crop' | 'full';
  className?: string;
}) {
  const [art, setArt] = useState<CardArtData>(null);

  useEffect(() => {
    let cancelled = false;
    setArt(null);
    getCardArt(name).then((result) => {
      if (!cancelled) setArt(result);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!art) return <div className={`card-art-fallback ${className ?? ''}`} aria-hidden />;

  const src = variant === 'crop' ? art.artCrop : art.normal;
  return <img className={`card-art ${className ?? ''}`} src={src} alt={name} loading="lazy" />;
}
