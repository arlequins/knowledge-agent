const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const OUTPUT_HOLDBACK_CHARACTERS = 32;

function matchingSuffix(value: string, marker: string) {
  const maximum = Math.min(value.length, marker.length - 1);
  for (let length = maximum; length > 0; length -= 1)
    if (marker.startsWith(value.slice(-length))) return length;
  return 0;
}

function normalizedToken(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

export function repeatedSequenceStart(value: string, size = 8) {
  const words = [...value.matchAll(/\S+/gu)].map((match) => ({
    index: match.index,
    value: normalizedToken(match[0]),
  }));
  const occurrences = new Map<string, number>();
  for (let index = 0; index <= words.length - size; index += 1) {
    const phrase = words
      .slice(index, index + size)
      .map((word) => word.value)
      .join(" ");
    if (!phrase.trim()) continue;
    const previous = occurrences.get(phrase);
    if (previous !== undefined && index - previous >= size)
      return words[index]?.index;
    if (previous === undefined) occurrences.set(phrase, index);
  }
  return undefined;
}

export class StreamingOutputGuard {
  private emittedLength = 0;
  private rawBuffer = "";
  private reasoning = false;
  private stoppedValue = false;
  private visible = "";

  get stopped() {
    return this.stoppedValue;
  }

  private stripReasoning(chunk: string) {
    this.rawBuffer += chunk;
    let output = "";
    while (this.rawBuffer) {
      const marker = this.reasoning ? THINK_CLOSE : THINK_OPEN;
      const markerIndex = this.rawBuffer.indexOf(marker);
      if (markerIndex >= 0) {
        if (!this.reasoning) output += this.rawBuffer.slice(0, markerIndex);
        this.rawBuffer = this.rawBuffer.slice(markerIndex + marker.length);
        this.reasoning = !this.reasoning;
        continue;
      }
      const held = matchingSuffix(this.rawBuffer, marker);
      const completed = this.rawBuffer.slice(
        0,
        held > 0 ? this.rawBuffer.length - held : undefined,
      );
      if (!this.reasoning) output += completed;
      this.rawBuffer = held > 0 ? this.rawBuffer.slice(-held) : "";
      break;
    }
    return output;
  }

  push(chunk: string) {
    if (this.stoppedValue) return "";
    this.visible += this.stripReasoning(chunk);
    const repeatedAt = repeatedSequenceStart(this.visible);
    if (repeatedAt !== undefined) {
      this.stoppedValue = true;
      const safe = this.visible.slice(this.emittedLength, repeatedAt);
      this.emittedLength = repeatedAt;
      return safe;
    }
    const safeEnd = Math.max(
      this.emittedLength,
      this.visible.length - OUTPUT_HOLDBACK_CHARACTERS,
    );
    const safe = this.visible.slice(this.emittedLength, safeEnd);
    this.emittedLength = safeEnd;
    return safe;
  }

  flush() {
    if (this.stoppedValue) return "";
    this.visible += this.stripReasoning("");
    if (!this.reasoning) {
      this.visible += this.rawBuffer;
      this.rawBuffer = "";
    }
    const safe = this.visible.slice(this.emittedLength);
    this.emittedLength = this.visible.length;
    return safe;
  }
}
