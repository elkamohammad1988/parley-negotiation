// The route-level fallback for the debrief.
//
// The room hands off here by a client-side transition after a still beat, and
// the debrief opens in the room's own register for the reveal. Without this
// file the root loading screen, which is cream, would flash between the two
// dark surfaces and break the one continuous crossing the product stages.
export default function DebriefLoading() {
  return (
    <div className="pl-room pl-act" aria-busy="true">
      <style>{`body { background: var(--pl-room-ground); }`}</style>
    </div>
  )
}
