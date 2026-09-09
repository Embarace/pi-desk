import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: false,
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("rel", "noopener noreferrer");
    node.addEventListener("click", (e) => {
      e.preventDefault();
      const href = node.getAttribute("href") || "";
      if (/^https?:\/\//.test(href)) void window.pidesk.openExternal(href);
    });
  }
});

const ALLOWED = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "strong", "em", "del", "u", "s", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img", "table",
    "thead", "tbody", "tr", "th", "td", "span", "div", "input", "details", "summary",
    "sup", "sub", "kbd", "dl", "dt", "dd",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "colspan", "rowspan", "align", "type", "checked", "disabled"],
  ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/|pidesk-file:|pidesk-media:|mailto:)/i,
};

export function renderMarkdown(md: string): string {
  let html = "";
  try {
    html = marked.parse(md, { async: false }) as string;
  } catch {
    html = `<pre>${md.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
  }
  return DOMPurify.sanitize(html, ALLOWED);
}

export function plainTextOf(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
