let saved;
try {
    saved = localStorage.getItem('pl-theme');
} catch (e) {
    saved = null;
}
document.documentElement.setAttribute('data-theme', saved || 'light');
