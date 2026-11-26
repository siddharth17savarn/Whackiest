export const STATES = Object.freeze({
  PROMISED: 'PROMISED',
  CLAIMED: 'CLAIMED',
  OBSERVED: 'OBSERVED',
  VERIFIED: 'VERIFIED',
  CONTRADICTION: 'CONTRADICTION',
  OVERDUE: 'OVERDUE',
});

export const VALID_TRANSITIONS = Object.freeze({
  PROMISED: new Set(['CLAIMED', 'OVERDUE', 'OBSERVED', 'CONTRADICTION']),
  CLAIMED: new Set(['OBSERVED', 'CONTRADICTION', 'OVERDUE']),
  OVERDUE: new Set(['CLAIMED', 'OBSERVED', 'CONTRADICTION']),
  OBSERVED: new Set(['VERIFIED', 'CONTRADICTION']),
  CONTRADICTION: new Set(['OBSERVED', 'VERIFIED']),
  VERIFIED: new Set([]),
});

export function canTransition(fromState, toState) {
  if (!fromState) return toState === STATES.PROMISED;
  if (fromState === toState) return true;
  const allowed = VALID_TRANSITIONS[fromState];
  return allowed ? allowed.has(toState) : false;
}

export function transitionItem(item, nextState) {
  const current = item.state || item.status || STATES.PROMISED;
  if (!canTransition(current, nextState)) {
    throw new Error(`Invalid state transition: ${current} -> ${nextState}`);
  }
  item.state = nextState;
  item.status = nextState;
  if (nextState === STATES.VERIFIED) {
    item.verified = true;
  }
  return item;
}

export function effectiveState(item, nowMs = Date.now()) {
  const st = item.state || item.status;
  if (item.verified || st === STATES.VERIFIED) return STATES.VERIFIED;
  if (item.observedOk === false || item.observed?.ok === false || st === STATES.CONTRADICTION) {
    return STATES.CONTRADICTION;
  }
  const dueTs = item.due ?? (item.deadline ? new Date(item.deadline + 'T23:59:59').getTime() : null);
  if (dueTs && dueTs < nowMs && !item.verified) return STATES.OVERDUE;
  if (st && STATES[st]) return st;
  if (item.observed || item.observedOk != null) return STATES.OBSERVED;
  if (item.claimed || item.claimedAt) return STATES.CLAIMED;
  return STATES.PROMISED;
}
