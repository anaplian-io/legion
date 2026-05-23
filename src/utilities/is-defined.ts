export const isDefined = <T>(item: T | undefined): item is T => {
  return typeof item !== 'undefined';
};
