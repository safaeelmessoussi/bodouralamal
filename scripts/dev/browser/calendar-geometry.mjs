/** Evaluated in Chrome by both disposable and populated-localhost readers. */
export function inspectMonthGrid() {
  const grid = document.querySelector('.cal-grid');
  if (!grid || getComputedStyle(grid).display === 'none') return { visible: false };
  const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1;
  const disjoint = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const cells = [...grid.querySelectorAll('tbody tr:first-child td')];
  const widths = cells.map(c => c.getBoundingClientRect().width);
  const buttons = [...grid.querySelectorAll('.event-chip--interactive')];
  return {
    visible: true,
    sevenColumns: grid.querySelectorAll('thead th').length === 7 &&
      [...grid.querySelectorAll('tbody tr')].every(r => r.children.length === 7) &&
      Math.max(...widths) - Math.min(...widths) < 1,
    rtl: getComputedStyle(grid).direction === 'rtl' && cells[0].getBoundingClientRect().left > cells[6].getBoundingClientRect().left,
    datesFit: [...grid.querySelectorAll('.cal-day__select')].every(b => {
      const h = b.querySelector('.cal-day__hijri').getBoundingClientRect();
      const g = b.querySelector('.cal-day__gregorian').getBoundingClientRect();
      return disjoint(h, g) && inside(h, b.getBoundingClientRect()) && inside(g, b.getBoundingClientRect()) && h.left <= g.left;
    }),
    datesReadable: [...grid.querySelectorAll('.cal-day__gregorian, .cal-day__hijri')].every(d => parseFloat(getComputedStyle(d).fontSize) >= 13),
    populated: buttons.length > 0,
    eventsFit: buttons.every(b => inside(b.getBoundingClientRect(), b.closest('td').getBoundingClientRect())),
    tappable: buttons.every(b => b.getBoundingClientRect().width >= 28 && b.getBoundingClientRect().height >= 32),
    noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  };
}
