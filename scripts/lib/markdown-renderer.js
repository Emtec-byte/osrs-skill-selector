function normalizeSource(source) {
  return typeof source === "string" ? source.replace(/\r\n?/g, "\n") : "";
}

function isBlankLine(line) {
  return line.trim() === "";
}

function isUnorderedLine(line) {
  return /^[-*]\s+/.test(line);
}

function isOrderedLine(line) {
  return /^\d+\.\s+/.test(line);
}

function isChecklistLine(line) {
  return /^[-*]\s+\[(?: |x|X)\]\s+/.test(line);
}

function isHeadingLine(line) {
  return /^#{1,4}\s+/.test(line);
}

function isQuoteLine(line) {
  return /^>\s?/.test(line);
}

function isDividerLine(line) {
  return /^-{3,}\s*$/.test(line);
}

function sanitizeMarkdownUrl(rawUrl, doc = document) {
  if (typeof rawUrl !== "string") {
    return null;
  }

  const candidate = rawUrl.trim();
  if (!candidate) {
    return null;
  }

  if (candidate.startsWith("#") || candidate.startsWith("./") || candidate.startsWith("../") || (candidate.startsWith("/") && !candidate.startsWith("//"))) {
    return {
      href: candidate,
      external: false,
    };
  }

  try {
    const parsed = new URL(candidate, doc.baseURI);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      const currentOrigin = doc.defaultView?.location?.origin;
      return {
        href: parsed.href,
        external: parsed.protocol === "mailto:" || (currentOrigin ? parsed.origin !== currentOrigin : true),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function appendTextNode(parent, text, doc = document) {
  if (!text) {
    return;
  }

  parent.appendChild(doc.createTextNode(text));
}

function findNextSpecialIndex(text, start) {
  const candidates = [
    text.indexOf("**", start),
    text.indexOf("*", start),
    text.indexOf("`", start),
    text.indexOf("[", start),
  ].filter((index) => index !== -1);

  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function appendInlineNodes(parent, text, doc = document, depth = 0) {
  if (depth >= 20) {
    appendTextNode(parent, text, doc);
    return;
  }

  let index = 0;

  while (index < text.length) {
    if (text.startsWith("**", index)) {
      const endIndex = text.indexOf("**", index + 2);
      if (endIndex !== -1) {
        const strong = doc.createElement("strong");
        appendInlineNodes(strong, text.slice(index + 2, endIndex), doc, depth + 1);
        parent.appendChild(strong);
        index = endIndex + 2;
        continue;
      }
    }

    if (text[index] === "*" && text[index + 1] !== "*") {
      const endIndex = text.indexOf("*", index + 1);
      if (endIndex !== -1) {
        const emphasis = doc.createElement("em");
        appendInlineNodes(emphasis, text.slice(index + 1, endIndex), doc, depth + 1);
        parent.appendChild(emphasis);
        index = endIndex + 1;
        continue;
      }
    }

    if (text[index] === "`") {
      const endIndex = text.indexOf("`", index + 1);
      if (endIndex !== -1) {
        const code = doc.createElement("code");
        code.textContent = text.slice(index + 1, endIndex);
        parent.appendChild(code);
        index = endIndex + 1;
        continue;
      }
    }

    if (text[index] === "[") {
      const labelEnd = text.indexOf("](", index + 1);
      if (labelEnd !== -1) {
        const urlEnd = text.indexOf(")", labelEnd + 2);
        if (urlEnd !== -1) {
          const label = text.slice(index + 1, labelEnd);
          const safeUrl = sanitizeMarkdownUrl(text.slice(labelEnd + 2, urlEnd), doc);
          if (safeUrl) {
            const link = doc.createElement("a");
            link.href = safeUrl.href;
            link.textContent = label || safeUrl.href;
            if (safeUrl.external) {
              link.target = "_blank";
              link.rel = "noopener noreferrer";
            }
            parent.appendChild(link);
            index = urlEnd + 1;
            continue;
          }
        }
      }
    }

    const nextIndex = findNextSpecialIndex(text, index + 1);
    const sliceEnd = nextIndex === -1 ? text.length : nextIndex;
    appendTextNode(parent, text.slice(index, sliceEnd), doc);
    index = sliceEnd;
  }
}

function renderParagraph(lines, doc = document) {
  const paragraph = doc.createElement("p");
  appendInlineNodes(paragraph, lines.join(" "), doc);
  return paragraph;
}

function renderQuote(lines, doc = document) {
  const blockquote = doc.createElement("blockquote");
  const paragraph = doc.createElement("p");

  lines.forEach((line, index) => {
    if (index > 0) {
      paragraph.appendChild(doc.createElement("br"));
    }
    appendInlineNodes(paragraph, line.replace(/^>\s?/, ""), doc);
  });

  blockquote.appendChild(paragraph);
  return blockquote;
}

function renderList(lines, ordered, doc = document) {
  const list = doc.createElement(ordered ? "ol" : "ul");
  let startValue = 1;

  if (ordered) {
    const firstMatch = lines[0]?.match(/^(\d+)\.\s+/);
    if (firstMatch) {
      startValue = Number.parseInt(firstMatch[1], 10);
      if (startValue > 1) {
        list.start = startValue;
      }
    }
  }

  lines.forEach((line) => {
    const item = doc.createElement("li");
    const content = ordered ? line.replace(/^\d+\.\s+/, "") : line.replace(/^[-*]\s+/, "");
    appendInlineNodes(item, content, doc);
    list.appendChild(item);
  });

  return list;
}

function renderChecklist(lines, doc = document) {
  const list = doc.createElement("ul");
  list.className = "markdown-editor__checklist";

  lines.forEach((line) => {
    const match = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const item = doc.createElement("li");
    item.className = "markdown-editor__checklist-item";

    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.className = "markdown-editor__checklist-box";
    checkbox.checked = Boolean(match && /x/i.test(match[1]));
    checkbox.setAttribute("aria-hidden", "true");

    const text = doc.createElement("span");
    appendInlineNodes(text, match?.[2] ?? line, doc);

    item.append(checkbox, text);
    list.appendChild(item);
  });

  return list;
}

export function renderMarkdownInto(container, source, options = {}) {
  const doc = container.ownerDocument ?? document;
  const normalized = normalizeSource(source);
  const lines = normalized.split("\n");
  const fragment = doc.createDocumentFragment();
  const placeholder = typeof options.placeholder === "string" ? options.placeholder : "";

  if (normalized.trim() === "") {
    const empty = doc.createElement("p");
    empty.className = "markdown-editor__placeholder";
    empty.textContent = placeholder;
    fragment.appendChild(empty);
    container.replaceChildren(fragment);
    return;
  }

  let index = 0;
  while (index < lines.length) {
    const currentLine = lines[index];

    if (currentLine.startsWith("```")) {
      index += 1;
      const codeLines = [];
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    if (isBlankLine(currentLine)) {
      index += 1;
      continue;
    }

    if (isDividerLine(currentLine)) {
      fragment.appendChild(doc.createElement("hr"));
      index += 1;
      continue;
    }

    if (isHeadingLine(currentLine)) {
      const headingMatch = currentLine.match(/^(#{1,4})\s+(.*)$/);
      const heading = doc.createElement(`h${headingMatch[1].length}`);
      appendInlineNodes(heading, headingMatch[2], doc);
      fragment.appendChild(heading);
      index += 1;
      continue;
    }

    if (isChecklistLine(currentLine)) {
      const checklistLines = [];
      while (index < lines.length && isChecklistLine(lines[index])) {
        checklistLines.push(lines[index]);
        index += 1;
      }
      fragment.appendChild(renderChecklist(checklistLines, doc));
      continue;
    }

    if (isUnorderedLine(currentLine)) {
      const listLines = [];
      while (index < lines.length && isUnorderedLine(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      fragment.appendChild(renderList(listLines, false, doc));
      continue;
    }

    if (isOrderedLine(currentLine)) {
      const listLines = [];
      while (index < lines.length && isOrderedLine(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      fragment.appendChild(renderList(listLines, true, doc));
      continue;
    }

    if (isQuoteLine(currentLine)) {
      const quoteLines = [];
      while (index < lines.length && isQuoteLine(lines[index])) {
        quoteLines.push(lines[index]);
        index += 1;
      }
      fragment.appendChild(renderQuote(quoteLines, doc));
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length
      && !isBlankLine(lines[index])
      && !lines[index].startsWith("```")
      && !isDividerLine(lines[index])
      && !isHeadingLine(lines[index])
      && !isChecklistLine(lines[index])
      && !isUnorderedLine(lines[index])
      && !isOrderedLine(lines[index])
      && !isQuoteLine(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    fragment.appendChild(renderParagraph(paragraphLines, doc));
  }

  container.replaceChildren(fragment);
}