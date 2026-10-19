// Thème appliqué avant l'affichage, pour éviter un flash clair/sombre.
try {
  var t = localStorage.getItem('motflix-theme');
  document.documentElement.dataset.theme =
    t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
}
