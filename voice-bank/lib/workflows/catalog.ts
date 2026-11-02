import data from './catalog-data.json' with { type: 'json' };

export const WORKFLOW_VERSION = data.version;
export const USER_FUNCTIONS = data.functions;
export const LOGICAL_TOOLS = data.tools;
export const functionById = (id: string) => USER_FUNCTIONS.find(f => f.id === id);
export const toolById = (id: string) => LOGICAL_TOOLS.find(t => t.id === id);
// These need device or platform adapters beyond the deterministic sandbox.
export const UNSUPPORTED_FUNCTIONS = new Set(['BI07', 'BI10', 'CA10', 'CA11', 'CA12']);
export const availableFunctions = () => USER_FUNCTIONS.map(f => ({ ...f, capability: UNSUPPORTED_FUNCTIONS.has(f.id) ? 'unavailable' : 'sandbox' }));
