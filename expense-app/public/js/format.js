const Fmt = (() => {
  function money(amount, currency) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return `${sign}${symbol}${abs.toFixed(2)}`;
  }

  function date(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate.length <= 10 ? `${isoDate}T00:00:00` : isoDate);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function dateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso.includes('Z') || iso.includes('T') ? iso : `${iso}Z`);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function initials(name) {
    if (!name) return '?';
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { money, date, dateTime, initials, escapeHtml };
})();
