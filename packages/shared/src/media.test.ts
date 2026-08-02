import { describe, expect, it } from 'vitest';
import { mediaKindOf } from './media';

// Pure Result-media classification (AGENTS.md §9 — test the pure core). The
// gallery renders <video> vs <img> off this kind; a video mis-classified as an
// image renders as a broken object, which is the bug this guards.
describe('mediaKindOf', () => {
  it('classifies known video extensions as video', () => {
    for (const url of [
      'https://cdn/clip.mp4',
      'https://cdn/clip.webm',
      'https://cdn/clip.mov',
      'https://cdn/clip.m4v',
      'https://cdn/clip.ogv',
      'https://cdn/clip.mkv',
    ]) {
      expect(mediaKindOf(url)).toBe('video');
    }
  });

  it('classifies image extensions (and the default) as image', () => {
    for (const url of [
      'https://cdn/still.png',
      'https://cdn/still.jpg',
      'https://cdn/still.webp',
    ]) {
      expect(mediaKindOf(url)).toBe('image');
    }
  });

  it('is case-insensitive on the extension', () => {
    expect(mediaKindOf('https://cdn/CLIP.MP4')).toBe('video');
    expect(mediaKindOf('https://cdn/STILL.PNG')).toBe('image');
  });

  it('ignores the query string and fragment when matching (signed URLs)', () => {
    expect(mediaKindOf('https://cdn/clip.mp4?token=abc&exp=1')).toBe('video');
    expect(mediaKindOf('https://cdn/clip.mp4#t=2')).toBe('video');
    // A query that merely mentions .mp4 must not flip an image to video.
    expect(mediaKindOf('https://cdn/still.png?ref=clip.mp4')).toBe('image');
  });

  it('defaults an extension-less or unknown URL to image', () => {
    expect(mediaKindOf('https://cdn/object')).toBe('image');
    expect(mediaKindOf('https://cdn/object.bin')).toBe('image');
    expect(mediaKindOf('')).toBe('image');
  });
});
