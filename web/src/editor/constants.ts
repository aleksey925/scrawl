export const previewDelayMs = 400;
export const draftDelayMs = 800;
export const draftMaxAgeMs = 30 * 24 * 3600 * 1000;

// where down the usable viewport the line a reader is actually looking at sits
export const readingFraction = 0.25;

// late images, fonts, math and diagrams move the document after mount, so the
// anchor is re-applied across a short window instead of once
export const stabiliseDelaysMs: readonly number[] = [0, 60, 180, 400, 800];

export const splitMin = 0.2;
export const splitMax = 0.8;
export const splitDefault = 0.5;

export const draftPrefix = 'scrawl.draft.';
export const anchorPrefix = 'scrawl.anchor.';
export const modeKey = 'scrawl.editor.mode';
export const splitKey = 'scrawl.editor.split';

export const uploadAccept = 'image/*,application/pdf';
