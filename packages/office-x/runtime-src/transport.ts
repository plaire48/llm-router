import type { AgentTransport } from '@genoffice/agent-core';
import { streamForProvider, type AiProviderConfig } from '@genoffice/ai-provider';

export function validateConfig(value: unknown): AiProviderConfig {
  const c = value as AiProviderConfig;
  if (!c || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200 ||
      typeof c.apiKey !== 'string' || c.apiKey.length > 16000 || typeof c.baseUrl !== 'string')
    throw new Error('provider_config_invalid');
  const url = new URL(c.baseUrl);
  if (url.username || url.password || url.hash || !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('provider_https_required');
  return { baseUrl: c.baseUrl, model: c.model.trim(), apiKey: c.apiKey };
}

// GenOffice owns provider routing, SSE parsing, tool arguments and timeout handling.
// Office X only maps its stream callbacks onto AgentTransport.
export function providerTransport(config: AiProviderConfig): AgentTransport {
  return { stream(request, cb) {
    const controller = new AbortController();
    void streamForProvider('custom', config, request.system, request.messages, request.tools, 4096, {
      signal: controller.signal, onDelta: cb.onDelta, onToolCall: cb.onToolCall,
      onReasoningDelta: cb.onReasoning, onStopReason: cb.onStopReason, onUsage: cb.onUsage,
    }).then(() => cb.onDone(), () => {
      // Provider errors may contain server bodies. Never forward them to logs or Office.
      if (controller.signal.aborted) cb.onDone();
      else cb.onError('모델 응답을 받지 못했습니다. 연결 설정과 모델의 도구 호출 지원을 확인해 주세요.');
    });
    return { cancel: () => controller.abort() };
  }};
}
