import { effectiveState } from './state.js';

export function filterLedgerItems(items, { query = '', filter = 'all', now = Date.now() } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (items || [])
    .map(item => ({ item, st: effectiveState(item, now) }))
    .filter(({ item, st }) => {
      if (filter === 'open' && !['PROMISED', 'CLAIMED', 'OBSERVED'].includes(st)) return false;
      if (filter === 'verified' && st !== 'VERIFIED') return false;
      if (filter === 'risk' && !['CONTRADICTION', 'OVERDUE'].includes(st)) return false;
      if (q) {
        const hay = `${item.company || ''} ${item.promise || ''} ${item.evidence || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}
