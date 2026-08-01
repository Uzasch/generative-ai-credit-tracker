import type { ToolAdapter } from './types';

/**
 * Flow (Google, Veo-based video) adapter.
 * TODO: fill in once we have captured Flow network samples (AGENTS.md open Q3).
 */
export const flowAdapter: ToolAdapter = {
  tool: 'flow',
  matches: (url) => url.includes('labs.google'),
  extract: (_res) => {
    // TODO: locate the credit/cost field and any job id in Flow's responses.
    return null;
  },
};
