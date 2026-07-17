import vm from "node:vm";

/**
 * MyNeta emits some table rows through packed document.write scripts. Evaluate
 * only those scripts in an isolated context with no process, filesystem, or
 * network globals, and retain the original script if decoding fails.
 */
export function deobfuscateMynetaHtml(html) {
  return html.replace(/<script>([\s\S]*?)<\/script>/gi, (all, code) => {
    if (!code.includes("eval(function")) return all;
    let output = "";
    try {
      vm.runInNewContext(
        code,
        { document: { write: (value) => { output += String(value); } }, console: { log() {} } },
        { timeout: 1000 },
      );
      return output || all;
    } catch {
      return all;
    }
  });
}
