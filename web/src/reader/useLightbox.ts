import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { imageCaption, imagesOf } from './dom';

export interface LightboxImage {
  src: string;
  alt: string;
  caption: string;
}

export interface Lightbox {
  image: LightboxImage | null;
  open: (image: HTMLImageElement) => void;
  close: () => void;
  step: (delta: number) => void;
}

export function useLightbox(rootRef: RefObject<HTMLDivElement | null>, html: string): Lightbox {
  const images = useRef<HTMLImageElement[]>([]);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    images.current = root === null ? [] : imagesOf(root);
    setIndex(null);
  }, [rootRef, html]);

  const open = useCallback((image: HTMLImageElement): void => {
    const at = images.current.indexOf(image);
    setIndex(at < 0 ? null : at);
  }, []);

  const close = useCallback((): void => setIndex(null), []);

  const step = useCallback((delta: number): void => {
    setIndex((current) => {
      const count = images.current.length;
      return current === null || count === 0 ? current : (current + delta + count) % count;
    });
  }, []);

  const source = index === null ? undefined : images.current[index];
  const image =
    source === undefined
      ? null
      : {
          src: source.currentSrc === '' ? source.src : source.currentSrc,
          alt: source.alt,
          caption: imageCaption(source),
        };

  return { image, open, close, step };
}
