// Line-diamond-line divider, matching the reference kit's "8 Rulers" motif —
// stands in for a plain border wherever a section break should read as
// deco chrome rather than just a layout seam. See .deco-rule in index.css.
export function DecoRule() {
  return (
    <div className="deco-rule" aria-hidden>
      <span className="deco-rule-line" />
      <span className="deco-rule-diamond" />
      <span className="deco-rule-line" />
    </div>
  );
}
