interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** HTML 요소를 만드는 짧은 도우미. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.class) element.className = options.class;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) element.setAttribute(key, value);
  for (const child of children) element.append(child);
  return element;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
