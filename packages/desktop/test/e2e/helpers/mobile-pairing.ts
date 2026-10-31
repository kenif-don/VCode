function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

/** 配对参数只留在内存；错误、控制台和页面文本不能把它们带入诊断记录。 */
export function redactMobileDiagnosticText(text: string, pairingUrl: string): string {
  const url = new URL(pairingUrl);
  const values = [
    ...url.searchParams.values(),
    ...new URLSearchParams(url.hash.slice(1)).values(),
    url.hash.slice(1),
  ];
  let result = text.split(pairingUrl).join(publicUrl(pairingUrl));
  for (const value of values) {
    if (value.length < 4) continue;
    result = result.split(value).join("<REDACTED>");
  }
  return result.replace(/https?:\/\/[^\s"'<>]+/gu, publicUrl);
}
