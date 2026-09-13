import { CloseButton, Modal, Text } from '@mantine/core';
import { useEffect, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

import { layout } from '../theme';

import type { LightboxImage } from './useLightbox';

// how far a finger travels before it counts as a swipe and not a tap
const swipeMin = 40;

export interface LightboxProps {
  image: LightboxImage | null;
  onClose: () => void;
  onStep: (delta: number) => void;
}

export function Lightbox({ image, onClose, onStep }: LightboxProps): JSX.Element {
  const from = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    if (image === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight') {
        onStep(1);
      }
      if (event.key === 'ArrowLeft') {
        onStep(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [image, onStep]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    from.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };

  // a finger has no arrow keys, so the set is stepped with a swipe
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = from.current;
    from.current = null;
    if (start === null) {
      return;
    }
    const moved = event.clientX - start.x;
    if (Math.abs(moved) < swipeMin || Math.abs(moved) <= Math.abs(event.clientY - start.y)) {
      return;
    }
    swiped.current = true;
    onStep(moved < 0 ? 1 : -1);
  };

  return (
    <Modal
      opened={image !== null}
      onClose={onClose}
      fullScreen
      padding={0}
      withCloseButton={false}
      aria-label="Image viewer"
      classNames={{ content: 'md-lightbox-content', body: 'md-lightbox-surface' }}
      overlayProps={{ backgroundOpacity: 0.85, blur: 12 }}
    >
      {image !== null && (
        <div className="md-lightbox-body" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
          <CloseButton
            className="md-lightbox-close"
            size={layout.tapTarget}
            variant="subtle"
            c="#fff"
            aria-label="Close the image"
            onClick={onClose}
          />
          {/* on a phone the image covers nearly the whole dialog and leaves
              almost no backdrop to aim at, so it closes on a tap of its own */}
          <img
            className="md-lightbox-image"
            src={image.src}
            alt={image.alt}
            onClick={() => {
              if (!swiped.current) {
                onClose();
              }
            }}
          />
          <Text className="md-lightbox-caption">{image.caption}</Text>
        </div>
      )}
    </Modal>
  );
}
