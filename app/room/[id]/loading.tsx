// The route-level fallback for the room.
//
// The brief hands off to the room by a client-side transition with the door
// already closed over the viewport — see BriefClient. Without this file the
// root loading screen, which is cream, would flash between the dark door and
// the dark room. This keeps the ground the room's own colour for the moment
// the route takes to arrive; the room client draws its own "opening" state on
// top once it mounts.
export default function RoomLoading() {
  return (
    <div className="pl-room pl-room-shell" aria-busy="true">
      <style>{`body { background: var(--pl-room-ground); }`}</style>
    </div>
  )
}
