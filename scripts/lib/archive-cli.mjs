/** Parse CLI filters shared by archive refresh scripts. */
export function parseArchiveCliArgs(argv = process.argv.slice(2)) {
  const onlyFolders = new Set();
  let onlyChamber = null;
  let onlyState = null;
  let summaryMoney = false;

  for (const arg of argv) {
    if (arg === "--summary-money") {
      summaryMoney = true;
      continue;
    }
    if (arg.startsWith("--chamber=")) {
      onlyChamber = arg.slice("--chamber=".length).trim();
      continue;
    }
    if (arg.startsWith("--state=")) {
      onlyState = arg.slice("--state=".length).trim();
      continue;
    }
    if (arg.startsWith("--folder=")) {
      for (const folder of arg.slice("--folder=".length).split(",")) {
        const value = folder.trim();
        if (value) onlyFolders.add(value.toLowerCase());
      }
    }
  }

  if (onlyChamber && onlyChamber !== "assembly" && onlyChamber !== "lok_sabha") {
    throw new Error(`Unsupported --chamber=${onlyChamber}`);
  }

  return { onlyChamber, onlyState, onlyFolders, summaryMoney };
}

export function filterManifestElections(elections, filters) {
  const { onlyChamber, onlyState, onlyFolders } = filters;
  return elections.filter((election) => {
    const chamber = election.chamber ?? "assembly";
    if (onlyChamber && chamber !== onlyChamber) return false;
    if (onlyState && election.state !== onlyState) return false;
    if (onlyFolders.size && !onlyFolders.has(election.folder.toLowerCase())) return false;
    return true;
  });
}
