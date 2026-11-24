// Money formatting. Amounts are kept as strings from NUMERIC columns and only
// converted for display, so no floating-point rounding sneaks into stored values.

export function formatMoney(amount, currency) {
  const value = Number(amount ?? 0);
  const decimals = currency === 'LBP' ? 0 : Number.isInteger(value) ? 0 : 2;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return currency === 'USD' ? `$${formatted}` : `${formatted} ل.ل`;
}

export function isFree(amount) {
  return Number(amount ?? 0) <= 0;
}
