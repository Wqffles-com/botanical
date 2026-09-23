/**
 * Split a SQL script on semicolons that are not inside single-quoted strings.
 * Line and block comments are copied through so apostrophes in comments
 * (for example "runtime's") do not look like string delimiters.
 */
export function splitSqlStatements(ddl: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  for (let i = 0; i < ddl.length; i += 1) {
    const char = ddl[i] ?? "";
    const next = ddl[i + 1] ?? "";

    if (!inSingle && char === "-" && next === "-") {
      const end = ddl.indexOf("\n", i);
      const line = end === -1 ? ddl.slice(i) : ddl.slice(i, end + 1);
      current += line;
      i += line.length - 1;
      continue;
    }
    if (!inSingle && char === "/" && next === "*") {
      const end = ddl.indexOf("*/", i + 2);
      const block = end === -1 ? ddl.slice(i) : ddl.slice(i, end + 2);
      current += block;
      i += block.length - 1;
      continue;
    }
    if (char === "'") {
      if (inSingle && next === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === ";" && !inSingle) {
      push(statements, current);
      current = "";
      continue;
    }
    current += char;
  }
  push(statements, current);
  return statements;
}

function push(statements: string[], raw: string): void {
  const statement = raw.trim();
  if (!statement) return;
  const executable = statement.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("--");
  });
  if (executable) statements.push(statement);
}
