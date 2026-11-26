import { STATES, effectiveState } from './state.js';

/**
 * Normalize a V0.2.0 or V0.3.0 record into the unified ledger schema.
 */
export function normalizeRecord(raw, nowMs = Date.now()) {
  const ts = raw.created || Date.now();
  const dueTs =
    raw.due ?? (raw.deadline ? new Date(raw.deadline + 'T23:59:59').getTime() : null);
  const deadline =
    raw.deadline ?? (dueTs ? new Date(dueTs).toISOString().slice(0, 10) : null);
  const st = effectiveState({ ...raw, due: dueTs, deadline }, nowMs);

  return {
    id: String(raw.id ?? 'c' + ts),
    company: raw.company || 'Unknown',
    companySource: raw.companySource || 'hostname',
    promise: raw.promise || '',
    deadline,
    originalDeadline: raw.originalDeadline || null,
    revisions: raw.revisions || 0,
    due: dueTs,
    conditions: raw.conditions ?? raw.condition ?? null,
    condMet: Boolean(raw.condMet),
    state: st,
    status: st,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.75,
    source: raw.source || raw.chat || '',
    sourceMeta: raw.sourceMeta || null,
    evidence: raw.evidence || raw.promise || '',
    hash: raw.hash || '',
    transcript: Array.isArray(raw.transcript) ? raw.transcript : [],
    created: ts,
    claimed: raw.claimed || (raw.claimEvidence ? { text: raw.claimEvidence, at: raw.claimedAt || ts } : null),
    claimedAt: raw.claimedAt || raw.claimed?.at || null,
    claimEvidence: raw.claimEvidence || raw.claimed?.text || null,
    observed: raw.observed || (raw.observedOk != null ? { ok: raw.observedOk, note: raw.observedNote || '', at: ts } : null),
    observedOk: raw.observedOk ?? raw.observed?.ok ?? null,
    observedNote: raw.observedNote ?? raw.observed?.note ?? null,
    verified: st === STATES.VERIFIED || Boolean(raw.verified),
    timeline: Array.isArray(raw.timeline) && raw.timeline.length
      ? raw.timeline
      : [{ status: st, ts, note: 'Migrated record' }],
  };
}

/**
 * Export a unified record in the format expected by mcp/aftermath_mcp_v3.py.
 */
export function toMcpRecord(item, nowMs = Date.now()) {
  const norm = normalizeRecord(item, nowMs);
  return {
    id: norm.id,
    company: norm.company,
    promise: norm.promise,
    deadline: norm.deadline,
    originalDeadline: norm.originalDeadline,
    revisions: norm.revisions || null,
    conditions: norm.conditions,
    status: norm.state,
    state: norm.state,
    confidence: norm.confidence,
    observedOk: norm.observedOk,
    observedNote: norm.observedNote,
    evidence: norm.evidence,
    source: norm.source,
    hash: norm.hash,
    timeline: norm.timeline,
    transcript: norm.transcript,
  };
}
