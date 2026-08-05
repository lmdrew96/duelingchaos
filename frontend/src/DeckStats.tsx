import './DeckStats.css';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
const COLOR_LABEL: Record<(typeof COLOR_ORDER)[number], string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

type DeckStatsProps = {
  manaCurve: number[];
  colorCounts: Record<string, number>;
};

// Mana curve (bucketed by CMC, lands excluded) and color balance (spell
// count per color, lands excluded) for the deck currently being built.
// Numbers come pre-computed from Deckbuilder — this is presentation only.
export function DeckStats({ manaCurve, colorCounts }: DeckStatsProps) {
  const maxCurve = Math.max(1, ...manaCurve);
  const maxColor = Math.max(1, ...COLOR_ORDER.map((c) => colorCounts[c] ?? 0));

  return (
    <div className="deck-stats">
      <h2 style={{ marginTop: 20 }}>Mana curve</h2>
      <div className="curve-chart">
        {manaCurve.map((count, cmc) => (
          <div className="curve-col" key={cmc}>
            <span className="curve-count">{count || ''}</span>
            <div
              className="curve-bar"
              style={{ height: `${(count / maxCurve) * 100}%` }}
              title={`${count} card${count === 1 ? '' : 's'} at mana value ${cmc === manaCurve.length - 1 ? `${cmc}+` : cmc}`}
            />
            <span className="curve-label">{cmc === manaCurve.length - 1 ? `${cmc}+` : cmc}</span>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 20 }}>Color balance</h2>
      <div className="color-chart">
        {COLOR_ORDER.filter((c) => (colorCounts[c] ?? 0) > 0).map((c) => (
          <div className="color-row" key={c}>
            <span className={`color-swatch color-swatch-${c.toLowerCase()}`} title={COLOR_LABEL[c]} />
            <div className="color-bar-track">
              <div className="color-bar-fill" style={{ width: `${(colorCounts[c] / maxColor) * 100}%` }} />
            </div>
            <span className="color-count">{colorCounts[c]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
