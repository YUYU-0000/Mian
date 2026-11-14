const chinese = /([\p{Script=Han}\u3000-\u303f\uff01-\uff60]+)/u;

// 中文单独缩放，英文数字和代码的原有字号不变。
export default function ChineseText({ text }: { text: string }) {
  return text.split(chinese).map((part, index) =>
    index % 2 ? (
      <span className="bubble-chinese" key={index}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function chineseHighlight(html: string) {
  return html
    .split(/(<[^>]*>)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            new RegExp(chinese.source, "gu"),
            '<span class="bubble-chinese">$1</span>',
          ),
    )
    .join("");
}
