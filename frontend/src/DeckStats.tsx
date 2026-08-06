import type { ExpandedDeckStats } from './deckStatsUtils';
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
  expanded: ExpandedDeckStats;
};

// Mana curve (bucketed by CMC, lands excluded) and color balance (spell
// count per color, lands excluded) for the deck currently being built.
// Numbers come pre-computed from Deckbuilder — this is presentation only.
export function DeckStats({ manaCurve, colorCounts, expanded }: DeckStatsProps) {
  const maxCurve = Math.max(1, ...manaCurve);
  const maxColor = Math.max(1, ...COLOR_ORDER.map((c) => colorCounts[c] ?? 0));
  const maxBalance = Math.max(1, ...expanded.manaBalance.flatMap((b) => [b.pips, b.sources]));
  const totalCards = expanded.landCount + expanded.nonLandCount;
  const landPct = totalCards > 0 ? Math.round((expanded.landCount / totalCards) * 100) : 0;

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

      <h2 style={{ marginTop: 20 }}>Lands</h2>
      <p className="stats-line">
        <span className="stats-number">{expanded.landCount}</span> land
        {expanded.landCount === 1 ? '' : 's'} ·{' '}
        <span className="stats-number">{expanded.nonLandCount}</span> nonland ({landPct}% land)
      </p>

      {expanded.manaBalance.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>Mana cost vs. sources</h2>
          <p className="empty-hint">Colored pips required (top) against how many lands can produce that color (bottom).</p>
          <div className="balance-chart">
            {expanded.manaBalance.map(({ color, pips, sources }) => (
              <div className="balance-row" key={color}>
                <span
                  className={`color-swatch color-swatch-${color.toLowerCase()}`}
                  title={COLOR_LABEL[color as (typeof COLOR_ORDER)[number]]}
                />
                <div className="balance-bars">
                  <div className="color-bar-track">
                    <div className="color-bar-fill" style={{ width: `${(pips / maxBalance) * 100}%` }} />
                  </div>
                  <div className="color-bar-track">
                    <div className="color-bar-fill balance-sources" style={{ width: `${(sources / maxBalance) * 100}%` }} />
                  </div>
                </div>
                <span className="color-count">
                  {pips} / {sources}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ marginTop: 20 }}>Land draw probability</h2>
      <p className="empty-hint">Chance of having drawn at least one land by each turn, on the play.</p>
      <div className="curve-chart">
        {expanded.drawProbabilities.map(({ turn, probability }) => (
          <div className="curve-col" key={turn}>
            <span className="curve-count">{Math.round(probability * 100)}%</span>
            <div className="curve-bar" style={{ height: `${probability * 100}%` }} title={`Turn ${turn}`} />
            <span className="curve-label">T{turn}</span>
          </div>
        ))}
      </div>

      {expanded.tokenTypes.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>Tokens this deck creates</h2>
          <div className="token-tag-list">
            {expanded.tokenTypes.map((t) => (
              <span className="token-tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
