export function smartSplitHtml(text: string, limit: number = 4000): string[] {
  if (text.length <= limit) return [text];

  const fragments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      fragments.push(remaining);
      break;
    }

    const { cutAt, candidate, stack } = findOptimalCut(remaining, limit);

    let finalCandidate = candidate;
    let nextPrefix = "";

    if (stack.length > 0) {
      for (let i = stack.length - 1; i >= 0; i--) {
        finalCandidate += `</${stack[i]}>`;
      }
      for (const tag of stack) {
        nextPrefix += `<${tag}>`;
      }
    }

    fragments.push(finalCandidate.trimEnd());
    remaining = nextPrefix + remaining.substring(cutAt).trimStart();

    if (remaining.length === nextPrefix.length) break;
  }

  return fragments;
}

function findOptimalCut(
  text: string,
  limit: number,
): { cutAt: number; candidate: string; stack: string[] } {
  let cutAt = limit;

  while (cutAt > 0) {
    let bestCut = text.lastIndexOf("\n\n", cutAt);
    if (bestCut <= 0 || bestCut > cutAt)
      bestCut = text.lastIndexOf("\n", cutAt);
    if (bestCut <= 0 || bestCut > cutAt) bestCut = text.lastIndexOf(" ", cutAt);
    if (bestCut <= 0) bestCut = cutAt;

    let candidate = text.substring(0, bestCut);

    const lastOpen = candidate.lastIndexOf("<");
    const lastClose = candidate.lastIndexOf(">");
    if (lastOpen > lastClose) {
      bestCut = lastOpen;
      candidate = text.substring(0, bestCut);
    }

    const stack = getHtmlTagStack(candidate);
    const closingLength = stack.reduce((acc, t) => acc + t.length + 3, 0);

    if (candidate.length + closingLength <= limit || bestCut <= 10) {
      return { cutAt: bestCut, candidate, stack };
    }
    cutAt = bestCut - 1;
  }

  return { cutAt: limit, candidate: text.substring(0, limit), stack: [] };
}

function getHtmlTagStack(html: string): string[] {
  const pattern =
    /<(b|i|u|s|code|pre|a|strong|em|blockquote|del|ins)\b[^>]*>|<\/(b|i|u|s|code|pre|a|strong|em|blockquote|del|ins)>/gi;
  const stack: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const isClosing = match[0].startsWith("</");
    const tagName = (match[1] || match[2])?.toLowerCase();
    if (tagName) {
      if (isClosing) {
        if (stack.length > 0 && stack[stack.length - 1] === tagName) {
          stack.pop();
        }
      } else {
        stack.push(tagName);
      }
    }
  }
  return stack;
}
