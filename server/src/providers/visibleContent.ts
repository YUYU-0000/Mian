// 跨流式分片丢弃原生 think 内容，公开的 mian-thinking 保留。
export class VisibleContent {
  private pending = "";
  private thinking = false;

  finish() {
    return !this.thinking && this.pending === "<" ? "<" : "";
  }

  push(chunk: string) {
    this.pending += chunk;
    let output = "";
    while (this.pending) {
      const marker = this.thinking ? "</think>" : "<think>";
      const index = this.pending.toLowerCase().indexOf(marker);
      if (index >= 0) {
        if (!this.thinking) output += this.pending.slice(0, index);
        this.pending = this.pending.slice(index + marker.length);
        this.thinking = !this.thinking;
        continue;
      }
      let held = 0;
      for (let size = 1; size < marker.length; size += 1)
        if (this.pending.toLowerCase().endsWith(marker.slice(0, size)))
          held = size;
      const end = this.pending.length - held;
      if (!this.thinking) output += this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      break;
    }
    return output;
  }
}
