import type { CSSProperties } from 'react';
import { CardArt } from './CardArt';
import './HeroCardFan.css';

type FanStyle = CSSProperties & { '--i': number };

// A curated set of visually dramatic cards, not tied to any real deck —
// pure atmosphere for the marketing surfaces. Real Scryfall art is already
// used throughout Board/Deckbuilder; the landing page was the one screen
// that never used the app's own most "Magic" asset.
const HERO_CARDS = [
  'Craterhoof Behemoth',
  'Wrath of God',
  'Elesh Norn, Grand Cenobite',
  'Cyclonic Rift',
  'Lightning Bolt',
  'Sol Ring',
];

export function HeroCardFan({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const mid = (HERO_CARDS.length - 1) / 2;
  return (
    <div className={`hero-fan${size === 'sm' ? ' hero-fan-sm' : ''}`} aria-hidden>
      {HERO_CARDS.map((name, i) => (
        <div
          className="hero-fan-card"
          key={name}
          style={{ '--i': i - mid, zIndex: HERO_CARDS.length - Math.abs(i - mid) } as FanStyle}
        >
          <CardArt name={name} variant="crop" className="hero-fan-art" />
        </div>
      ))}
    </div>
  );
}
