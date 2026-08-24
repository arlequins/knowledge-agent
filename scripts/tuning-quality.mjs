function normalized(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedClaim(value) {
  return normalized(value).replace(/^[`'"([{<]+|[`'"),\]}>.:;]+$/gu, "");
}

function tokens(value) {
  return normalized(value).split(" ").filter(Boolean);
}

export function repeatedNgrams(value, size = 8) {
  const words = tokens(value);
  const occurrences = new Map();
  const repeated = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    const phrase = words.slice(index, index + size).join(" ");
    const previous = occurrences.get(phrase);
    if (previous !== undefined && index - previous >= size)
      repeated.add(phrase);
    else if (previous === undefined) occurrences.set(phrase, index);
  }
  return [...repeated];
}

export function repeatedSentences(value) {
  const seen = new Set();
  const repeated = new Set();
  for (const sentence of value.split(/(?<=[.!?。！？])\s+|\n+/u)) {
    const candidate = normalized(sentence);
    if (candidate.length < 24) continue;
    if (seen.has(candidate)) repeated.add(candidate);
    else seen.add(candidate);
  }
  return [...repeated];
}

export function technicalClaims(value) {
  const claims = new Set();
  const patterns = [
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/giu,
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gu,
    /\bcron\s*\([^)]*\)/giu,
    /https?:\/\/[^\s)\]}]+/giu,
    /\b[^\s/]+\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|md|java|rb|cs)\b/giu,
    /\b\d+(?:\.\d+)?\s*(?:초|분|시간|일|주|개월|년|회|%|mb|gb|tokens?)\b/giu,
  ];
  for (const pattern of patterns)
    for (const match of value.matchAll(pattern))
      claims.add(normalizedClaim(match[0]));
  return [...claims];
}

export function unsupportedTechnicalClaims(answer, allowedEvidence) {
  const allowed = normalized(allowedEvidence);
  return technicalClaims(answer).filter((claim) => !allowed.includes(claim));
}

export function scoreTuningProbe(example, answer) {
  const allowedEvidence = [
    example.answer,
    ...(example.evidence ?? []).map((item) => item.content),
  ].join("\n");
  const required = example.requiredTerms.map((term) => ({
    matched: normalized(answer).includes(normalized(term)),
    term,
  }));
  const forbidden = example.forbiddenTerms.map((term) => ({
    matched: normalized(answer).includes(normalized(term)),
    term,
  }));
  const repeatedNgramMatches = repeatedNgrams(answer);
  const repeatedSentenceMatches = repeatedSentences(answer);
  const unsupportedClaims = unsupportedTechnicalClaims(answer, allowedEvidence);
  const unexpectedChinese =
    /[\u4e00-\u9fff]/u.test(answer) && /[가-힣]/u.test(example.question);
  return {
    forbidden,
    passed:
      required.every((item) => item.matched) &&
      forbidden.every((item) => !item.matched) &&
      repeatedNgramMatches.length === 0 &&
      repeatedSentenceMatches.length === 0 &&
      unsupportedClaims.length === 0 &&
      !unexpectedChinese,
    repeatedNgrams: repeatedNgramMatches,
    repeatedSentences: repeatedSentenceMatches,
    required,
    unexpectedChinese,
    unsupportedClaims,
  };
}
