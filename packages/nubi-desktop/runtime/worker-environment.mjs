import tls from 'node:tls';

// Applies only inside the dedicated service process, before framework imports.
// Parent Electron/VS Code and user shell environments remain unchanged.
export function disableHostedTracing(environment){
  for(const key of Object.keys(environment))if(/^(?:LANGSMITH_|LANGCHAIN_(?:TRACING|API_KEY|ENDPOINT|PROJECT|SESSION|VERBOSE)|OTEL_)/i.test(key))delete environment[key];
}

// Keep the bundled and explicitly configured roots, adding Windows' existing
// trust store before the worker opens any provider connection.
export function configureSystemTrust({platform=process.platform,api=tls}={}){
  if(platform!=='win32')return;
  if(typeof api.getCACertificates!=='function'||typeof api.setDefaultCACertificates!=='function')throw Error('system_ca_unavailable');
  api.setDefaultCACertificates([...new Set([...api.getCACertificates('default'),...api.getCACertificates('system')])]);
}
