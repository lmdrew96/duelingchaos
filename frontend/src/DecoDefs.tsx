// Single shared <defs> block, mounted once at the app root — every deco SVG
// (DecoCorner, DecoCrown, the life-badge ornament) references url(#gold-gradient)
// instead of a flat fill/stroke, so the linework reads as lit metal rather
// than a flat outline. One definition avoids duplicate-id drift if any of
// those components' own gradient stops ever need to change.
export function DecoDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f5dc7a" />
          <stop offset="100%" stopColor="#c9932a" />
        </linearGradient>
      </defs>
    </svg>
  );
}
