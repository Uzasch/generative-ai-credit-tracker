/**
 * Result media kind — whether a completed Job's output is a still image or a
 * video. The tools we track return both (a Higgsfield image generation yields
 * e.g. a `.png`, a video generation a `.mp4`), but a `JobOutcome` carries only
 * its `mediaUrl` with no explicit type field. So the kind is derived from the URL
 * once, at the gallery projection edge (`toGenerationView`), and carried on the
 * view — the renderer then switches `<video>` vs `<img>` off this explicit
 * discriminator instead of every renderer re-sniffing the URL. A video rendered
 * in an `<img>` shows a broken object, which is the bug this closes.
 */
export type MediaKind = 'image' | 'video';

/** One Result media output plus its rendered kind. */
export type ResultMedia = {
  url: string;
  kind: MediaKind;
};

/**
 * Path suffixes we render as video (lowercased, no dot-stripping needed). Anything
 * else — including an extension-less or unknown URL — falls through to `image`,
 * the safe default: stills dominate, and an unknown URL shows fine in an `<img>`.
 */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv'] as const;

/**
 * Classify a Result media URL as image or video from its path extension. MV3
 * captures give us only the URL (`JobOutcome.mediaUrl`), so this sniffs the path —
 * the query string and fragment are stripped first so a signed URL like
 * `…/clip.mp4?token=…#t=2` still reads as a video. Unknown/extension-less URLs
 * default to `image`.
 */
export function mediaKindOf(url: string): MediaKind {
  // Drop the query and fragment before matching, then lowercase the path so a
  // `.MP4` or `.Mp4` still matches.
  const path = (url.split(/[?#]/, 1)[0] ?? '').toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext)) ? 'video' : 'image';
}
