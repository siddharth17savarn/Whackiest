(function (root) {
  const STOP = new Set(
    'the a an is are was were be been to and or in on for it of with has have had will we your you i my our that this side good news'.split(
      ' '
    )
  );

  function sigWords(s) {
    return new Set(
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP.has(w))
    );
  }

  function jaccard(a, b) {
    const A = sigWords(a);
    const B = sigWords(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / (A.size + B.size - inter);
  }

  function rankPromiseMatches(claimText, items, company) {
    const cw = sigWords(claimText);
    const open = (items || []).filter(it => {
      const st = it.state || it.status || 'PROMISED';
      return (
        it.company === company &&
        !it.verified &&
        st !== 'VERIFIED' &&
        st !== 'CONTRADICTION' &&
        st !== 'CLAIMED'
      );
    });

    const candidates = open
      .map(item => {
        const pw = sigWords(item.promise);
        let score = 0;
        for (const w of cw) if (pw.has(w)) score++;
        return { item, score };
      })
      .sort((a, b) => b.score - a.score || (a.item.created || 0) - (b.item.created || 0));

    if (!candidates.length) return { best: null, candidates: [], ambiguous: false };
    const top = candidates[0];
    const tiedTop = candidates.length > 1 && candidates[1].score === top.score;
    const ambiguous = top.score === 0 || tiedTop;
    return {
      best: top.score > 0 && !tiedTop ? top.item : null,
      candidates,
      ambiguous,
    };
  }

  const api = { sigWords, jaccard, rankPromiseMatches };
  root.AMXMatching = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
