export type StoryScalar = string | number | boolean;

type Token = {
  type: "literal" | "identifier" | "operator" | "paren";
  value: string;
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const space = rest.match(/^\s+/);
    if (space) {
      index += space[0].length;
      continue;
    }
    const string = rest.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
    if (string) {
      tokens.push({ type: "literal", value: string[0] });
      index += string[0].length;
      continue;
    }
    const number = rest.match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ type: "literal", value: number[0] });
      index += number[0].length;
      continue;
    }
    const operator = rest.match(/^(===|!==|==|!=|>=|<=|&&|\|\||>|<|!)/);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0] });
      index += operator[0].length;
      continue;
    }
    const paren = rest.match(/^[()]/);
    if (paren) {
      tokens.push({ type: "paren", value: paren[0] });
      index += 1;
      continue;
    }
    const identifier = rest.match(/^[a-zA-Z_][a-zA-Z0-9_.-]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    throw new Error(`条件表达式包含不支持的字符：${rest[0]}`);
  }
  return tokens;
}

export function evaluateStoryExpression(
  source: string,
  values: Record<string, StoryScalar>,
): boolean {
  const tokens = tokenize(source);
  let position = 0;
  const literal = (token: Token): StoryScalar => {
    if (token.type === "identifier") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (!(token.value in values))
        throw new Error(`未声明的变量：${token.value}`);
      return values[token.value];
    }
    if (/^-?\d/.test(token.value)) return Number(token.value);
    return JSON.parse(
      token.value.replace(/^'/, '"').replace(/'$/, '"'),
    ) as string;
  };
  const primary = (): StoryScalar => {
    const token = tokens[position++];
    if (!token) throw new Error("条件表达式不完整");
    if (token.type === "paren" && token.value === "(") {
      const value = or();
      if (tokens[position++]?.value !== ")")
        throw new Error("条件表达式缺少右括号");
      return value;
    }
    if (token.type !== "identifier" && token.type !== "literal")
      throw new Error("条件表达式需要变量或常量");
    return literal(token);
  };
  const unary = (): StoryScalar => {
    if (tokens[position]?.value === "!") {
      position += 1;
      return !unary();
    }
    return primary();
  };
  const comparison = (): StoryScalar => {
    const left = unary();
    const operator = tokens[position]?.value;
    if (!["===", "!==", "==", "!=", ">", "<", ">=", "<="].includes(operator))
      return left;
    position += 1;
    const right = unary();
    if (operator === "==" || operator === "===") return left === right;
    if (operator === "!=" || operator === "!==") return left !== right;
    if (typeof left !== "number" || typeof right !== "number")
      throw new Error("大小比较只支持数值变量");
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    return left <= right;
  };
  const and = (): StoryScalar => {
    let value = comparison();
    while (tokens[position]?.value === "&&") {
      position += 1;
      value = Boolean(value) && Boolean(comparison());
    }
    return value;
  };
  const or = (): StoryScalar => {
    let value = and();
    while (tokens[position]?.value === "||") {
      position += 1;
      value = Boolean(value) || Boolean(and());
    }
    return value;
  };
  const result = Boolean(or());
  if (position !== tokens.length) throw new Error("条件表达式存在多余内容");
  return result;
}
