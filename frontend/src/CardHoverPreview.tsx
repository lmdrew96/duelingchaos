import { CardArt } from './CardArt';

// Desktop-hover companion to the click-to-pin card detail modals used across
// the board and deckbuilder: floats the full card face beside the hovered
// tile/row so it can be read without leaving the surrounding list/board.
// Positioned from the anchor's own rect (not the cursor) so it doesn't
// jitter as the mouse moves within it, and clamped to the viewport since
// tiles/rows near an edge would otherwise push it off-screen.
export function CardHoverPreview({ name, anchor }: { name: string; anchor: HTMLElement }) {
  const rect = anchor.getBoundingClientRect();
  const width = 240;
  let left = rect.right + 12;
  if (left + width > window.innerWidth - 12) left = rect.left - width - 12;
  left = Math.max(12, left);
  const top = Math.min(Math.max(12, rect.top), window.innerHeight - 340);

  return (
    <div className="card-hover-preview" style={{ top, left, width }}>
      <CardArt name={name} variant="full" className="card-hover-preview-art" />
    </div>
  );
}
