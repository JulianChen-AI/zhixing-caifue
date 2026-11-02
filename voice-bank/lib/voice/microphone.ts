/** Explain why the microphone could not start; the voice session itself keeps running. */
export function microphoneMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const reason = name === 'NotAllowedError' || name === 'SecurityError' ? '麦克风权限被拒绝'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? '没有找到可用的麦克风'
    : name === 'NotReadableError' || name === 'AbortError' ? '麦克风正被其他应用占用'
    : name === 'NotSupportedError' ? '当前页面无法使用麦克风，请通过 HTTPS 或 localhost 打开'
    : '麦克风暂时无法开启';
  return `${reason}。可以继续打字，语音回复照常。`;
}
