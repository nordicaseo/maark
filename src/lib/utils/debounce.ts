export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): T & { cancel: () => void } {
  let timer: NodeJS.Timeout | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
  };

  return debounced as T & { cancel: () => void };
}
