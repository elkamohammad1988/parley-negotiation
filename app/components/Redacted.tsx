// A block of redaction bars — the product's central image.
//
// It draws no text and receives none: the shape is synthetic, a stack of bars
// at plausible line lengths. Covering real text with a black rectangle would
// leave it selectable, searchable and readable in the DOM, which for the
// counterpart's mandate would defeat the entire product. The bars are
// decorative and the meaning is carried by the accessible label.
//
// The same object appears in the room (sealed, for the whole rehearsal) and
// on the debrief (the instant before it lifts). Sharing the component is what
// makes it read as the same object.
export default function Redacted({ lines = 4, label }: { lines?: number; label: string }) {
  return (
    <div className="pl-redact" role="img" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="pl-redact__bar" />
      ))}
    </div>
  )
}
