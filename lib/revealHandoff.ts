// The handoff between the room and the debrief.
//
// The reveal is the product's one piece of theatre, and it should play exactly
// once: when you arrive on the debrief straight from the room, with the
// mandate you spent fourteen minutes not being able to read. Opening the same
// debrief from the dashboard a week later is reading a record, and a record
// does not re-stage its own unsealing.
//
// The room leaves a note in sessionStorage as it ends; the debrief takes the
// note, plays the reveal, and clears it. Session-scoped rather than persisted
// so a second browser or a cleared session simply reads the record — the safe
// failure is no theatre, never a wrong mandate.
//
// This carries NO mandate content. It is a flag with a rehearsal id on it, and
// the mandate itself still arrives only from /api/debrief once the rehearsal
// has ended.

const PREFIX = 'parley_reveal:'

export function markRevealPending(rehearsalId: string): void {
  try {
    sessionStorage.setItem(PREFIX + rehearsalId, 'pending')
  } catch {
    // Storage unavailable — the debrief reads as a record. Nothing is lost.
  }
}

/** True once, then false: taking the note clears it. */
export function takeRevealPending(rehearsalId: string): boolean {
  try {
    const key = PREFIX + rehearsalId
    const pending = sessionStorage.getItem(key) === 'pending'
    if (pending) sessionStorage.removeItem(key)
    return pending
  } catch {
    return false
  }
}
