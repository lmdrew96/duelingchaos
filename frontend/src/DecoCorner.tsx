// A faceted, glowing triple-line corner bracket, reused (with CSS mirroring)
// at the four corners of singular chrome panels — shared between Board and
// Deckbuilder so both surfaces speak the same deco language instead of
// Deckbuilder staying flat/undecorated. Three concentric L-strokes (gradient
// gold, not flat) with diamond finials at each vertex and a soft outer glow
// via .deco-corner's filter — the reference kit's depth comes from stacked
// concentric strokes + luminous linework, not a single flat-filled outline.
export function DecoCorner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <svg viewBox="0 0 24 24" className={`deco-corner ${position}`} aria-hidden>
      <path d="M24 2 L2 2 L2 24" fill="none" stroke="url(#gold-gradient)" strokeWidth="1.5" />
      <path d="M24 6.5 L6.5 6.5 L6.5 24" fill="none" stroke="url(#gold-gradient)" strokeWidth="1" opacity="0.7" />
      <path d="M24 10.5 L10.5 10.5 L10.5 24" fill="none" stroke="url(#gold-gradient)" strokeWidth="0.75" opacity="0.4" />
      <rect x="-0.5" y="-0.5" width="5" height="5" fill="url(#gold-gradient)" transform="rotate(45 2 2)" />
      <rect x="4.5" y="4.5" width="4" height="4" fill="url(#gold-gradient)" opacity="0.75" transform="rotate(45 6.5 6.5)" />
      <rect x="8.75" y="8.75" width="3.5" height="3.5" fill="url(#gold-gradient)" opacity="0.5" transform="rotate(45 10.5 10.5)" />
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
