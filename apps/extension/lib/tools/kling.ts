import type { ToolAdapter } from './types';

/**
 * Kling (Kuaishou video) adapter.
 * TODO: fill in once we have captured Kling network samples.
 */
export const klingAdapter: ToolAdapter = {
  tool: 'kling',
  matches: (url) => url.includes('klingai.com'),
  extract: (_res) => {
    // TODO: locate the credit/cost field and any job id in Kling responses.
    return null;
  },
};
