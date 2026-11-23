import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

type Segment = { text: string } | { variable: string };

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** A stored prompt as text and variables, in order. */
export function toSegments(value: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (match.index > last) segments.push({ text: value.slice(last, match.index) });
    segments.push({ variable: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last) });
  return segments;
}

function chip(key: string, label: string, unknown: boolean): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "prompt-chip";
  element.contentEditable = "false";
  element.dataset["variable"] = key;
  if (unknown) {
    element.dataset["unknown"] = "true";
    element.title = "This variable does not exist in this pipeline";
  }
  element.textContent = label;
  return element;
}

/** The stored form of what the editor shows: chips become their {{ }} names. */
function read(node: Node): string {
  let text = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
    else if (child instanceof HTMLElement && child.dataset["variable"]) text += `{{${child.dataset["variable"]}}}`;
    else if (child instanceof HTMLBRElement) text += "\n";
    else if (child instanceof HTMLElement) text += (/^(DIV|P)$/.test(child.tagName) && text && !text.endsWith("\n") ? "\n" : "") + read(child);
  });
  return text;
}

/**
 * A prompt where each variable is a chip with a plain name. The stored form stays `{{task.description}}`; an unknown
 * variable shows in red while it is typed. `insertRef` lets the Insert menu add a variable at the caret.
 */
export function PromptEditor({ value, onChange, label, labelOf, isUnknown, insertRef, testId }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  labelOf: (key: string) => string;
  isUnknown: (key: string) => boolean;
  insertRef?: { current: ((key: string) => void) | null };
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);

  const render = useCallback((text: string) => {
    const element = box.current;
    if (!element) return;
    element.replaceChildren(...toSegments(text).map((segment) =>
      "variable" in segment ? chip(segment.variable, labelOf(segment.variable), isUnknown(segment.variable)) : document.createTextNode(segment.text)));
    shown.current = text;
  }, [labelOf, isUnknown]);

  // The text is drawn once and when it changes from outside; while typing the editor already shows it.
  useLayoutEffect(() => {
    if (value !== shown.current) render(value);
    else {
      // Names and unknown marks follow the pipeline as it is edited.
      box.current?.querySelectorAll<HTMLElement>("[data-variable]").forEach((element) => {
        const key = element.dataset["variable"] ?? "";
        element.textContent = labelOf(key);
        if (isUnknown(key)) element.dataset["unknown"] = "true";
        else delete element.dataset["unknown"];
      });
    }
  }, [value, render, labelOf, isUnknown]);

  const emit = (): void => {
    const element = box.current;
    if (!element) return;
    const next = read(element);
    shown.current = next;
    onChange(next);
  };

  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (key) => {
      const element = box.current;
      if (!element) return;
      element.focus();
      const selection = window.getSelection();
      let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!range || !element.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }
      range.deleteContents();
      const made = chip(key, labelOf(key), isUnknown(key));
      range.insertNode(made);
      range.setStartAfter(made);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      emit();
    };
    return () => { insertRef.current = null; };
  // emit only reads refs and the latest onChange.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRef, labelOf, isUnknown, onChange]);

  return (
    <div
      ref={box}
      className="prompt-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-testid={testId}
      spellCheck
      onInput={emit}
      onBlur={() => render(read(box.current ?? document.body))}
    />
  );
}
