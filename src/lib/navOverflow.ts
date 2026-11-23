/**
 * Nombre d'entrées du menu qui tiennent dans la largeur disponible.
 * Si toutes ne tiennent pas, on réserve la place du bouton « Plus » (qui regroupe le reste).
 * Au moins une entrée reste toujours visible à côté du bouton « Plus ».
 */
export function visibleNavCount(itemWidths: number[], moreWidth: number, available: number, gap: number): number {
  const widthOf = (count: number) =>
    itemWidths.slice(0, count).reduce((sum, w) => sum + w, 0) + gap * Math.max(0, count - 1)

  if (widthOf(itemWidths.length) <= available) return itemWidths.length

  let count = itemWidths.length - 1
  while (count > 1 && widthOf(count) + gap + moreWidth > available) count--
  return Math.max(1, count)
}
