'use client';

import { ConvexGalleryContainer } from '@/components/gallery/ConvexGalleryContainer';
import { SyntheticGalleryContainer } from '@/components/gallery/SyntheticGalleryContainer';
import { ConvexClientProvider, convexConfigured } from '../providers';

/**
 * The Generation Gallery (issue #7): a dashboard page, not the popup. When a
 * Convex deployment is configured it reads live gallery queries; otherwise it
 * renders the clearly-synthetic placeholder demo so the design surface and its
 * keyboard-first triage are operable without a backend. Either way the same
 * presentational `GalleryView` renders.
 */
export default function GalleryPage(): JSX.Element {
  if (!convexConfigured) return <SyntheticGalleryContainer />;
  return (
    <ConvexClientProvider>
      <ConvexGalleryContainer />
    </ConvexClientProvider>
  );
}
