/** Hides only Node's "SQLite is an experimental feature" notice, which would confuse non-developers. Import first. */
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (/SQLite is an experimental feature/.test(text)) return;
  return (original as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
