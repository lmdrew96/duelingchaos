// A small diamond-and-hairline corner ornament, reused (with CSS mirroring)
// at the four corners of singular chrome panels — shared between Board and
// Deckbuilder so both surfaces speak the same deco language instead of
// Deckbuilder staying flat/undecorated.
export function DecoCorner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <svg viewBox="0 0 20 20" className={`deco-corner ${position}`} aria-hidden>
      <rect x="6" y="6" width="8" height="8" fill="var(--gold)" transform="rotate(45 10 10)" />
      <line x1="10" y1="10" x2="20" y2="10" stroke="var(--gold)" strokeWidth="1.5" />
      <line x1="10" y1="10" x2="10" y2="20" stroke="var(--gold)" strokeWidth="1.5" />
    </svg>
  );
}

export function DecoCorners() {
  return (
    <>
      <DecoCorner position="tl" />
      <DecoCorner position="tr" />
      <DecoCorner position="bl" />
      <DecoCorner position="br" />
    </>
  );
}
