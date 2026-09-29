// Applies only inside the dedicated service process, before framework imports.
// Parent Electron/VS Code and user shell environments remain unchanged.
export function disableHostedTracing(environment){
  for(const key of Object.keys(environment))if(/^(?:LANGSMITH_|LANGCHAIN_(?:TRACING|API_KEY|ENDPOINT|PROJECT|SESSION|VERBOSE)|OTEL_)/i.test(key))delete environment[key];
}
