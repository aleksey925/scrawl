declare module '@plantuml/core' {
  export interface RenderOptions {
    dark?: boolean;
    maxSvgSize?: number;
  }

  export function renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: RenderOptions,
  ): void;
}

declare module '@plantuml/core/viz-global.js' {
  const viz: { instance: () => Promise<unknown> };
  export default viz;
}
