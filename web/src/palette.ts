// GitHub's Primer palette, read off github.com, under its own token names. The
// app and a rendered note are both painted from it, so the two cannot drift
// apart; a note reaches it as --gh-*, the way github-markdown-css names it
export interface Palette {
  fgDefault: string;
  // not Primer tokens: a note's text and its emphasis, which in the dark sit
  // below and above fgDefault, so bold differs in brightness and not only weight
  fgBody: string;
  fgEmphasis: string;
  fgMuted: string;
  fgAccent: string;
  fgSuccess: string;
  fgAttention: string;
  fgDanger: string;
  fgDone: string;
  bgDefault: string;
  bgMuted: string;
  bgInset: string;
  bgNeutralMuted: string;
  // not Primer tokens: a <mark> is a highlighter, opaque yellow under dark text
  // in both schemes, because a translucent yellow over the dark ground is brown
  bgMark: string;
  fgMark: string;
  bgAccentMuted: string;
  bgAccentEmphasis: string;
  // not a Primer token: the next step of its blue scale, for a filled hover
  bgAccentEmphasisHover: string;
  controlRest: string;
  controlHover: string;
  borderDefault: string;
  borderMuted: string;
  borderEmphasis: string;
  borderAccentMuted: string;
  borderAccentEmphasis: string;
  borderSuccessEmphasis: string;
  borderAttentionEmphasis: string;
  borderDangerEmphasis: string;
  borderDoneEmphasis: string;
  // Primer's diffBlob tokens: the ground of a changed line, and of a changed
  // word within it
  diffAdditionLine: string;
  diffAdditionWord: string;
  diffDeletionLine: string;
  diffDeletionWord: string;
}

export const lightPalette: Palette = {
  fgDefault: '#1f2328',
  fgBody: '#1f2328',
  fgEmphasis: '#1f2328',
  fgMuted: '#59636e',
  fgAccent: '#0969da',
  fgSuccess: '#1a7f37',
  fgAttention: '#9a6700',
  fgDanger: '#d1242f',
  fgDone: '#8250df',
  bgDefault: '#ffffff',
  bgMuted: '#f6f8fa',
  bgInset: '#f6f8fa',
  bgNeutralMuted: '#818b981f',
  bgMark: '#fff8c5',
  fgMark: '#1f2328',
  bgAccentMuted: '#ddf4ff',
  bgAccentEmphasis: '#0969da',
  bgAccentEmphasisHover: '#0550ae',
  controlRest: '#f6f8fa',
  controlHover: '#eff2f5',
  borderDefault: '#d1d9e0',
  borderMuted: '#d1d9e0b3',
  borderEmphasis: '#818b98',
  borderAccentMuted: '#54aeff66',
  borderAccentEmphasis: '#0969da',
  borderSuccessEmphasis: '#1a7f37',
  borderAttentionEmphasis: '#9a6700',
  borderDangerEmphasis: '#cf222e',
  borderDoneEmphasis: '#8250df',
  diffAdditionLine: '#dafbe1',
  diffAdditionWord: '#aceebb',
  diffDeletionLine: '#ffebe9',
  diffDeletionWord: '#ff818266',
};

// Primer's dark dimmed text and accents on a ground darker than its own; its
// dark put near-white text on near-black, and bold was lost among the glare
export const darkPalette: Palette = {
  fgDefault: '#d1d7e0',
  fgBody: '#b7bdc8',
  fgEmphasis: '#f0f6fc',
  fgMuted: '#9198a1',
  fgAccent: '#478be6',
  fgSuccess: '#57ab5a',
  fgAttention: '#c69026',
  fgDanger: '#e5534b',
  fgDone: '#986ee2',
  bgDefault: '#121821',
  bgMuted: '#1a2129',
  bgInset: '#0d1117',
  // twice Primer's alpha: at its 20% inline code was hard to tell from the page
  bgNeutralMuted: '#656c7666',
  bgMark: '#d4b04a',
  fgMark: '#1f2328',
  bgAccentMuted: '#4184e41a',
  bgAccentEmphasis: '#316dca',
  bgAccentEmphasisHover: '#4184e4',
  controlRest: '#212830',
  controlHover: '#262c36',
  borderDefault: '#3d444d',
  borderMuted: '#3d444db3',
  borderEmphasis: '#656c76',
  borderAccentMuted: '#4184e466',
  borderAccentEmphasis: '#316dca',
  borderSuccessEmphasis: '#347d39',
  borderAttentionEmphasis: '#966600',
  borderDangerEmphasis: '#c93c37',
  borderDoneEmphasis: '#8256d0',
  diffAdditionLine: '#46954a26',
  diffAdditionWord: '#46954a66',
  diffDeletionLine: '#e5534b26',
  diffDeletionWord: '#e5534b66',
};

// tokenVariables spells a token object as custom properties: fgDefault under
// the prefix gh becomes --gh-fg-default
export function tokenVariables(prefix: string, tokens: object): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    res[`--${prefix}-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = String(value);
  }
  return res;
}
