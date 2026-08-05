// A pointed ogee-dome finial, anchored top-center and overlapping the top
// edge of a panel — the rectangular-panel analog of the reference kit's
// scalloped hero frame (which crowns its whole border with this same
// pointed-dome silhouette). Reserved for the centered "hero" panels
// (prompt/choice/card-detail/graveyard) rather than every panel, since a
// dense list panel repeating this would read as noise, not ornament.
export function DecoCrown() {
  return (
    <svg viewBox="0 0 48 28" className="deco-crown" aria-hidden>
      <path
        d="M6 26 C6 16, 2 10, 24 2 C46 10, 42 16, 42 26"
        fill="none"
        stroke="url(#gold-gradient)"
        strokeWidth="1.5"
      />
      <path
        d="M12 26 C12 17, 10 12, 24 7 C38 12, 36 17, 36 26"
        fill="none"
        stroke="url(#gold-gradient)"
        strokeWidth="1"
        opacity="0.6"
      />
      <rect x="21.5" y="-0.5" width="5" height="5" fill="url(#gold-gradient)" transform="rotate(45 24 2)" />
    </svg>
  );
}
