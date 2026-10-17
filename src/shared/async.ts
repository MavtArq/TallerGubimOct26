/** Cede un frame para que la UI se repinte antes de un trabajo síncrono pesado. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
