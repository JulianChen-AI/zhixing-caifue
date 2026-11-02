import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneMessage } from '../lib/voice/microphone.ts';

const failure = (name: string) => new DOMException('', name);

test('a denied or missing microphone keeps typing available and names the cause', () => {
  assert.equal(microphoneMessage(failure('NotAllowedError')), '麦克风权限被拒绝。可以继续打字，语音回复照常。');
  assert.match(microphoneMessage(failure('NotFoundError')), /^没有找到可用的麦克风。/);
  assert.match(microphoneMessage(failure('NotReadableError')), /^麦克风正被其他应用占用。/);
  assert.match(microphoneMessage(failure('NotSupportedError')), /HTTPS 或 localhost/);
});

test('unknown microphone failures still fall back to typing', () => {
  for (const error of [new Error('boom'), 'x', undefined]) assert.equal(microphoneMessage(error), '麦克风暂时无法开启。可以继续打字，语音回复照常。');
});
