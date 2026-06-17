// In-memory pending-confirmation store for the /access flows (invite confirm,
// reason modal hand-off, termination confirm). TTL 10 min; survives between a
// button click and its follow-up, a bot restart just means re-running.
const pending = new Map();
let seq = 0;
export function putPending(p) {
    for (const [k, v] of pending) if (Date.now() - v.at > 600000) pending.delete(k);
    const t = String(++seq);
    pending.set(t, { ...p, at: Date.now() });
    return t;
}
export function takePending(t) { const v = pending.get(t); if (v) pending.delete(t); return v || null; }
export function peekPending(t) { return pending.get(t) || null; }
