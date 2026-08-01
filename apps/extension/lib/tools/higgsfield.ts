import type { ToolAdapter } from './types';

/**
 * Higgsfield (AI video/image) adapter.
 * TODO: fill in once we have captured Higgsfield network samples.
 */
export const higgsfieldAdapter: ToolAdapter = {
  tool: 'higgsfield',
  matches: (url) => url.includes('higgsfield.ai'),
  extract: (_res) => {
    // TODO: locate the credit/cost field and any job id in Higgsfield responses.
    return null;
  },
};
