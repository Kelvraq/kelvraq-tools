const shapes = {
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="m14 3 7 7-4 1-4 5-2-2-6 6M7 10l5-4 2-3M7 10l7 7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  up: '<path d="m6 13 6-6 6 6M12 7v13"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  drive:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h18M16 17h2"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5M12 13 3 8M12 13v9M7 5.8l9 5"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  file: '<path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 13h6M9 16h4"/>',
  game: '<path d="M7 7h10c3 0 5 11 2 12-2 1-4-3-5-3h-4c-1 0-3 4-5 3C2 18 4 7 7 7ZM7 10v5M4.5 12.5h5M16 11h.1M18 14h.1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  sort: '<path d="M8 4v16m-4-4 4 4 4-4M14 6h6M14 11h4M14 16h2"/>',
  refresh: '<path d="M20 10a8 8 0 1 0 0 5M20 4v6h-6"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${shapes[name] || shapes.file}</svg>`;
