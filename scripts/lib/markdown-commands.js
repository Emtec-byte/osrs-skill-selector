function clampSelection(value, selectionStart, selectionEnd) {
  const length = typeof value === "string" ? value.length : 0;
  const start = Math.min(length, Math.max(0, Number.isFinite(selectionStart) ? selectionStart : 0));
  const end = Math.min(length, Math.max(0, Number.isFinite(selectionEnd) ? selectionEnd : start));

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function replaceRange(value, start, end, replacement) {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

function getLineSelection(value, selectionStart, selectionEnd) {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const lineStart = value.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const block = value.slice(lineStart, lineEnd);

  return {
    start,
    end,
    lineStart,
    lineEnd,
    lines: block.split("\n"),
  };
}

function getCurrentLine(value, selectionStart, selectionEnd = selectionStart) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  return {
    ...lineSelection,
    line: value.slice(lineSelection.lineStart, lineSelection.lineEnd),
  };
}

function stripListPrefix(line) {
  const match = line.match(/^(\s*)(?:\d+\.\s+|[-*]\s+\[(?: |x|X)\]\s+|[-*]\s+)/);
  if (!match) {
    const indentMatch = line.match(/^\s*/);
    const indent = indentMatch?.[0] ?? "";
    return {
      indent,
      content: line.slice(indent.length),
    };
  }

  return {
    indent: match[1],
    content: line.slice(match[0].length),
  };
}

function isDividerLine(line) {
  return /^-{3,}\s*$/.test(line.trim());
}

function parseListLine(line) {
  if (isDividerLine(line)) {
    return null;
  }

  const checklistMatch = line.match(/^(\s*)([-*])\s+\[( |x|X)\]\s?(.*)$/);
  if (checklistMatch) {
    return {
      type: "checklist",
      indent: checklistMatch[1],
      marker: checklistMatch[2],
      content: checklistMatch[4] ?? "",
      nextPrefix: `${checklistMatch[1]}${checklistMatch[2]} [ ] `,
    };
  }

  const orderedMatch = line.match(/^(\s*)(\d+)\.\s?(.*)$/);
  if (orderedMatch) {
    return {
      type: "ordered",
      indent: orderedMatch[1],
      marker: orderedMatch[2],
      content: orderedMatch[3] ?? "",
      nextPrefix: `${orderedMatch[1]}${Number.parseInt(orderedMatch[2], 10) + 1}. `,
    };
  }

  const unorderedMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
  if (unorderedMatch) {
    return {
      type: "unordered",
      indent: unorderedMatch[1],
      marker: unorderedMatch[2],
      content: unorderedMatch[3] ?? "",
      nextPrefix: `${unorderedMatch[1]}${unorderedMatch[2]} `,
    };
  }

  return null;
}

function insertPrefixOnCurrentLine(value, selectionStart, selectionEnd, prefix) {
  const currentLine = getCurrentLine(value, selectionStart, selectionEnd);
  const nextLine = currentLine.line.trim() === ""
    ? prefix
    : `${prefix}${stripListPrefix(currentLine.line).content || currentLine.line}`;

  return {
    value: replaceRange(value, currentLine.lineStart, currentLine.lineEnd, nextLine),
    selectionStart: currentLine.lineStart + prefix.length,
    selectionEnd: currentLine.lineStart + prefix.length,
  };
}

function wrapInline(value, selectionStart, selectionEnd, prefix, suffix = prefix, placeholder = "text") {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const selectedText = value.slice(start, end);

  if (start !== end && selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
    const unwrapped = selectedText.slice(prefix.length, selectedText.length - suffix.length);
    return {
      value: replaceRange(value, start, end, unwrapped),
      selectionStart: start,
      selectionEnd: start + unwrapped.length,
    };
  }

  if (start === end) {
    const inserted = `${prefix}${placeholder}${suffix}`;
    return {
      value: replaceRange(value, start, end, inserted),
      selectionStart: start + prefix.length,
      selectionEnd: start + prefix.length + placeholder.length,
    };
  }

  const wrapped = `${prefix}${selectedText}${suffix}`;
  return {
    value: replaceRange(value, start, end, wrapped),
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selectedText.length,
  };
}

function insertLink(value, selectionStart, selectionEnd) {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const selectedText = value.slice(start, end);
  const label = selectedText || "link text";
  const url = "https://example.com";
  const inserted = `[${label}](${url})`;
  const nextValue = replaceRange(value, start, end, inserted);

  if (selectedText) {
    const urlStart = start + label.length + 3;
    return {
      value: nextValue,
      selectionStart: urlStart,
      selectionEnd: urlStart + url.length,
    };
  }

  return {
    value: nextValue,
    selectionStart: start + 1,
    selectionEnd: start + 1 + label.length,
  };
}

function togglePrefixedLines(value, selectionStart, selectionEnd, prefix, matcher) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  const nonEmptyLines = lineSelection.lines.filter((line) => line.trim() !== "");

  if (nonEmptyLines.length === 0) {
    return insertPrefixOnCurrentLine(value, selectionStart, selectionEnd, prefix);
  }

  const shouldRemove = nonEmptyLines.every((line) => matcher.test(line));
  const nextLines = lineSelection.lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }

    if (shouldRemove) {
      return line.replace(matcher, "");
    }

    if (matcher.test(line)) {
      return line;
    }

    const normalized = stripListPrefix(line);
    return `${normalized.indent}${prefix}${normalized.content}`;
  });
  const nextBlock = nextLines.join("\n");

  return {
    value: replaceRange(value, lineSelection.lineStart, lineSelection.lineEnd, nextBlock),
    selectionStart: lineSelection.lineStart,
    selectionEnd: lineSelection.lineStart + nextBlock.length,
  };
}

function toggleOrderedList(value, selectionStart, selectionEnd) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  const matcher = /^\d+\.\s+/;
  const nonEmptyLines = lineSelection.lines.filter((line) => line.trim() !== "");

  if (nonEmptyLines.length === 0) {
    return insertPrefixOnCurrentLine(value, selectionStart, selectionEnd, "1. ");
  }

  const shouldRemove = nonEmptyLines.every((line) => matcher.test(line));
  let order = 1;
  const nextLines = lineSelection.lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }

    if (shouldRemove) {
      return line.replace(matcher, "");
    }

    const normalized = stripListPrefix(line);
    const nextLine = `${normalized.indent}${order}. ${normalized.content}`;
    order += 1;
    return nextLine;
  });
  const nextBlock = nextLines.join("\n");

  return {
    value: replaceRange(value, lineSelection.lineStart, lineSelection.lineEnd, nextBlock),
    selectionStart: lineSelection.lineStart,
    selectionEnd: lineSelection.lineStart + nextBlock.length,
  };
}

function toggleChecklist(value, selectionStart, selectionEnd) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  const matcher = /^[-*]\s+\[(?: |x|X)\]\s+/;
  const nonEmptyLines = lineSelection.lines.filter((line) => line.trim() !== "");

  if (nonEmptyLines.length === 0) {
    return insertPrefixOnCurrentLine(value, selectionStart, selectionEnd, "- [ ] ");
  }

  const shouldRemove = nonEmptyLines.every((line) => matcher.test(line));
  const nextLines = lineSelection.lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }

    if (shouldRemove) {
      return line.replace(matcher, "");
    }

    if (matcher.test(line)) {
      return line;
    }

    const normalized = stripListPrefix(line);
    return `${normalized.indent}- [ ] ${normalized.content}`;
  });
  const nextBlock = nextLines.join("\n");

  return {
    value: replaceRange(value, lineSelection.lineStart, lineSelection.lineEnd, nextBlock),
    selectionStart: lineSelection.lineStart,
    selectionEnd: lineSelection.lineStart + nextBlock.length,
  };
}

function toggleHeading(value, selectionStart, selectionEnd, level) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  const matcher = /^(#{1,4})\s+/;
  const prefix = `${"#".repeat(level)} `;
  const nonEmptyLines = lineSelection.lines.filter((line) => line.trim() !== "");

  if (nonEmptyLines.length === 0) {
    return insertPrefixOnCurrentLine(value, selectionStart, selectionEnd, prefix);
  }

  const shouldRemove = nonEmptyLines.every((line) => {
    const match = line.match(matcher);
    return match?.[1]?.length === level;
  });

  const nextLines = lineSelection.lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }

    const content = line.replace(matcher, "");
    return shouldRemove ? content : `${prefix}${content}`;
  });
  const nextBlock = nextLines.join("\n");

  return {
    value: replaceRange(value, lineSelection.lineStart, lineSelection.lineEnd, nextBlock),
    selectionStart: lineSelection.lineStart,
    selectionEnd: lineSelection.lineStart + nextBlock.length,
  };
}

function toggleCodeBlock(value, selectionStart, selectionEnd) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  const block = value.slice(lineSelection.lineStart, lineSelection.lineEnd);
  const trimmedBlock = block.trim();

  if (trimmedBlock.startsWith("```") && trimmedBlock.endsWith("```")) {
    const lines = trimmedBlock.split("\n");
    const content = lines.slice(1, -1).join("\n");
    return {
      value: replaceRange(value, lineSelection.lineStart, lineSelection.lineEnd, content),
      selectionStart: lineSelection.lineStart,
      selectionEnd: lineSelection.lineStart + content.length,
    };
  }

  const selectedText = value.slice(lineSelection.start, lineSelection.end);
  if (lineSelection.start === lineSelection.end) {
    const inserted = "```\n\n```";
    return {
      value: replaceRange(value, lineSelection.start, lineSelection.end, inserted),
      selectionStart: lineSelection.start + 4,
      selectionEnd: lineSelection.start + 4,
    };
  }

  const wrapped = `\`\`\`\n${selectedText}\n\`\`\``;
  return {
    value: replaceRange(value, lineSelection.start, lineSelection.end, wrapped),
    selectionStart: lineSelection.start + 4,
    selectionEnd: lineSelection.start + 4 + selectedText.length,
  };
}

function adjustIndent(value, selectionStart, selectionEnd, direction) {
  const lineSelection = getLineSelection(value, selectionStart, selectionEnd);
  const nonEmptyLines = lineSelection.lines.filter((line) => line.trim() !== "");

  if (nonEmptyLines.length === 0) {
    if (direction === "in") {
      return {
        value: replaceRange(value, lineSelection.start, lineSelection.end, "  "),
        selectionStart: lineSelection.start + 2,
        selectionEnd: lineSelection.start + 2,
      };
    }

    return {
      value,
      selectionStart: lineSelection.start,
      selectionEnd: lineSelection.end,
    };
  }

  const nextLines = lineSelection.lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }

    if (direction === "in") {
      return `  ${line}`;
    }

    return line.replace(/^(?: {1,2}|\t)/, "");
  });
  const nextBlock = nextLines.join("\n");

  return {
    value: replaceRange(value, lineSelection.lineStart, lineSelection.lineEnd, nextBlock),
    selectionStart: lineSelection.lineStart,
    selectionEnd: lineSelection.lineStart + nextBlock.length,
  };
}

function insertDivider(value, selectionStart, selectionEnd) {
  const { start } = clampSelection(value, selectionStart, selectionEnd);
  const beforeNeedsNewline = start > 0 && value[start - 1] !== "\n";
  const afterNeedsNewline = start < value.length && value[start] !== "\n";
  const divider = `${beforeNeedsNewline ? "\n" : ""}---${afterNeedsNewline ? "\n" : ""}`;

  return {
    value: replaceRange(value, start, start, divider),
    selectionStart: start + divider.length,
    selectionEnd: start + divider.length,
  };
}

export function applyMarkdownCommand({ value = "", selectionStart = 0, selectionEnd = selectionStart, command }) {
  switch (command) {
    case "bold":
      return wrapInline(value, selectionStart, selectionEnd, "**", "**", "bold");
    case "italic":
      return wrapInline(value, selectionStart, selectionEnd, "*", "*", "italic");
    case "inline-code":
      return wrapInline(value, selectionStart, selectionEnd, "`", "`", "code");
    case "link":
      return insertLink(value, selectionStart, selectionEnd);
    case "bullet-list":
      return togglePrefixedLines(value, selectionStart, selectionEnd, "- ", /^[-*]\s+(?!\[(?: |x|X)\]\s)/);
    case "ordered-list":
      return toggleOrderedList(value, selectionStart, selectionEnd);
    case "checklist":
      return toggleChecklist(value, selectionStart, selectionEnd);
    case "indent":
      return adjustIndent(value, selectionStart, selectionEnd, "in");
    case "outdent":
      return adjustIndent(value, selectionStart, selectionEnd, "out");
    case "heading-1":
      return toggleHeading(value, selectionStart, selectionEnd, 1);
    case "heading-2":
      return toggleHeading(value, selectionStart, selectionEnd, 2);
    case "heading-3":
      return toggleHeading(value, selectionStart, selectionEnd, 3);
    case "heading-4":
      return toggleHeading(value, selectionStart, selectionEnd, 4);
    case "quote":
      return togglePrefixedLines(value, selectionStart, selectionEnd, "> ", /^>\s+/);
    case "code-block":
      return toggleCodeBlock(value, selectionStart, selectionEnd);
    case "divider":
      return insertDivider(value, selectionStart, selectionEnd);
    default:
      return {
        value,
        selectionStart,
        selectionEnd,
      };
  }
}

export function isMarkdownListLine(line = "") {
  return parseListLine(line) !== null;
}

export function handleMarkdownEnter({ value = "", selectionStart = 0, selectionEnd = selectionStart }) {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  if (start !== end) {
    return null;
  }

  const currentLine = getCurrentLine(value, start, end);
  const listInfo = parseListLine(currentLine.line);

  if (!listInfo) {
    return null;
  }

  if (listInfo.content.trim() === "") {
    return {
      value: replaceRange(value, currentLine.lineStart, currentLine.lineEnd, ""),
      selectionStart: currentLine.lineStart,
      selectionEnd: currentLine.lineStart,
    };
  }

  const listContentStart = currentLine.lineEnd - listInfo.content.length;
  if (start < listContentStart) {
    return {
      value: replaceRange(value, start, currentLine.lineEnd, `\n${listInfo.nextPrefix}${value.slice(start, currentLine.lineEnd)}`),
      selectionStart: start + 1 + listInfo.nextPrefix.length,
      selectionEnd: start + 1 + listInfo.nextPrefix.length,
    };
  }

  const tail = value.slice(start, currentLine.lineEnd);
  return {
    value: replaceRange(value, start, currentLine.lineEnd, `\n${listInfo.nextPrefix}${tail}`),
    selectionStart: start + 1 + listInfo.nextPrefix.length,
    selectionEnd: start + 1 + listInfo.nextPrefix.length,
  };
}
