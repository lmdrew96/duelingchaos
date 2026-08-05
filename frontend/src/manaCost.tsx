// Shared {N}{W}{U}... mana-cost tokenizer/renderer — used by the board's
// card tiles and the deckbuilder's search rows, so both surfaces treat a
// raw cost string the same way instead of drifting apart.
const COLOR_PIP_CLASS: Record<string, string> = {
  W: 'pip-w',
  U: 'pip-u',
  B: 'pip-b',
  R: 'pip-r',
  G: 'pip-g',
  C: 'pip-c',
};

function tokenClass(token: string): string {
  const upper = token.toUpperCase();
  if (COLOR_PIP_CLASS[upper]) return COLOR_PIP_CLASS[upper];
  return 'pip-generic';
}

export function parseManaCostTokens(cost: string): string[] {
  const matches = cost.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

export function ManaPips({ cost, size = 'sm' }: { cost: string; size?: 'sm' | 'md' }) {
  const tokens = parseManaCostTokens(cost);
  // No {} tokens (land with no cost, or an unrecognized format) — degrade
  // to raw text rather than showing nothing.
  if (tokens.length === 0) {
    return cost ? <span className="mana-pip-text">{cost}</span> : null;
  }
  return (
    <span className={`mana-pip-row mana-pip-row-${size}`}>
      {tokens.map((token, i) => (
        <span key={i} className={`mana-pip-sm ${size} ${tokenClass(token)}`} title={`{${token}}`}>
          {COLOR_PIP_CLASS[token.toUpperCase()] ? '' : token}
        </span>
      ))}
    </span>
  );
}
