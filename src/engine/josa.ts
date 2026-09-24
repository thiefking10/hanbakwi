/** 마지막 글자에 받침이 있는지 (한글이 아니면 없는 것으로 본다). */
export function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

/** 속초 → 속초를, 서울 → 서울을 */
export function eulReul(word: string): string {
  return word + (hasBatchim(word) ? "을" : "를");
}

/** 속초 → 속초로, 서울 → 서울로(ㄹ 받침), 강릉 → 강릉으로 */
export function euroRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const noBatchimOrRieul = !hasBatchim(word) || code % 28 === 8;
  return word + (noBatchimOrRieul ? "로" : "으로");
}
