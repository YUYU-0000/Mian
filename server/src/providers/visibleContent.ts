// 跨分片丢弃原生 think；文件正文里的同名标签是文件内容。
export class VisibleContent {
  private pending = "";
  private thinking = false;
  private file = false;

  finish() {
    return this.file ? this.pending : !this.thinking && this.pending === "<" ? "<" : "";
  }

  push(chunk: string) {
    this.pending += chunk;
    let output = "";
    while (this.pending) {
      const markers = this.thinking ? ["</think>"] : this.file ? ["</mian-file>"] : ["<think>", "<mian-file"];
      const next = markers.map(marker => ({ marker, index: this.pending.toLowerCase().indexOf(marker) }))
        .filter(item => item.index >= 0).sort((left, right) => left.index - right.index)[0];
      if (next) {
        const { marker, index } = next;
        if (!this.thinking) output += this.pending.slice(0, index);
        if (marker.includes("mian-file")) {
          output += this.pending.slice(index, index + marker.length);
          this.file = !this.file;
        } else this.thinking = !this.thinking;
        this.pending = this.pending.slice(index + marker.length);
        continue;
      }
      let held = 0;
      for (const marker of markers)
        for (let size = 1; size < marker.length; size += 1)
          if (this.pending.toLowerCase().endsWith(marker.slice(0, size)))
            held = Math.max(held, size);
      const end = this.pending.length - held;
      if (!this.thinking) output += this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      break;
    }
    return output;
  }
}
