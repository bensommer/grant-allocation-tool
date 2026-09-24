/** pnpm forwards a literal "--" to scripts; drop it so parseArgs sees only options. */
export function cliArgs(): string[] {
  const args = process.argv.slice(2);
  return args[0] === '--' ? args.slice(1) : args;
}
