export const NubiService = Symbol('NubiService');
export const NUBI_SERVICE_PATH = '/services/nubi';
export interface NubiService { invoke(method: string, args?: Record<string, unknown>): Promise<any>; }
