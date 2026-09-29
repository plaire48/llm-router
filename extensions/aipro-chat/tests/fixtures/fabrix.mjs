// Synthetic provider contract fixtures. These are not real account credentials.
export const connection = {endpoint: 'https://fabrix.example.test', modelId: 'qwen-test', clientKey: 'synthetic-client', token: 'synthetic-token', maxOutputTokens: 4096, contextLength: 128000};
export const models = [
  {modelId: connection.modelId, name: [{languageCode: 'en', content: 'Test model'}, {languageCode: 'ko', content: '테스트 모델'}], description: [{languageCode: 'ko', content: '[Context] 128K'}], types: []},
  {modelId: 'second-model-id', name: [{languageCode: 'ko', content: '추론 모델'}, {languageCode: 'en', content: 'Reasoning model'}], description: [{languageCode: 'ko', content: '[Context] 64K'}], types: []},
];
export const protocol = 'aipro-fabrix-tools-v1';
export function conversation(body) {
  const content = body.contents[0].split('\n\nTransport reminder:')[0];
  return content.startsWith('Conversation messages as JSON;') ? JSON.parse(content.slice(content.indexOf('\n') + 1)) : [{role: 'user', content}];
}
export function envelope(body, value) {
  const nonce = body.systemPrompt.match(/and request_id "([^"]+)"/)[1];
  return JSON.stringify({protocol, request_id: nonce, ...value});
}
export const toolReply = (body, name, args = {}) => envelope(body, {type: 'tool_calls', tool_calls: [{name, arguments: args}]});
export const messageReply = (body, content) => envelope(body, {type: 'message', content});
export function probeReply(body) {
  const messages = conversation(body), result = messages.findLast(message => message.role === 'tool');
  if (result) return messageReply(body, JSON.parse(result.content).value);
  const value = messages.at(-1).content.match(/value ([\w-]+)\./)[1];
  return toolReply(body, 'connection_echo', {value});
}
export function nativeResponse(content, {stream = false, usage, finish = 'stop'} = {}) {
  if (!stream) return Response.json({status: 'SUCCESS', content, finishReason: finish, filterBlockReason: {resultCode: 'FR-201'}, ...(usage ? {usage} : {})});
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  return new Response(frame({event_status: 'THINK', content: 'Private synthetic reasoning'}) + frame({event_status: 'CHUNK', content, finish_reason: finish, ...(usage ? {usage} : {})}) + 'data: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
}
