import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../client/src/api";
import Media from "../client/src/components/Media";
import TicketDrawer from "../client/src/components/TicketDrawer";
import { compressImage, blobToDataURL } from "../client/src/imageCompression";
import { exportHomePhotos, restoreHomePhotos, homePhotoKeys } from "../client/src/homePhotos";
import { openMediaDatabase, readSettingsMedia, writeMedia } from "../client/src/mediaStorage";
import type { ConversationRecord } from "../client/src/types";

const fixture = window as any;
const root = createRoot(document.getElementById("root")!);
let mount = 0;

fixture.image = async (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#a7745a");
  gradient.addColorStop(1, "#3b4d5a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
};
fixture.describe = async (file: Blob) => {
  const bitmap = await createImageBitmap(file);
  const result = { width: bitmap.width, height: bitmap.height, type: file.type };
  bitmap.close();
  return result;
};
fixture.rawMedia = async (key: string) => {
  const db = await openMediaDatabase("LauncherDB", "mediaStore");
  return new Promise<Blob>((resolve) => {
    const request = db.transaction("mediaStore").objectStore("mediaStore").get(`savedMediaFile_${key}`);
    request.onsuccess = () => resolve(request.result);
  });
};
fixture.seedMedia = (key: string, file: Blob) =>
  writeMedia("LauncherDB", "mediaStore", `savedMediaFile_${key}`, file);
fixture.upload = (selector: string, file: Blob) => {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  const files = new DataTransfer();
  files.items.add(new File([file], "photo.png", { type: file.type }));
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
fixture.renderMedia = () => root.render(
  <div key={++mount} style={{ position: "relative", width: 200, height: 180 }}>
    <Media storageKey={homePhotoKeys.widget} />
  </div>,
);

function Tickets({ records }: { records: ConversationRecord[] }) {
  const [conversations, setConversations] = useState(records);
  const update = async (
    id: string,
    patch: Partial<Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">>,
  ) => {
    const { conversation } = await api.updateConversation(id, patch);
    setConversations((current) => current.map((item) => item.conversationId === id ? conversation : item));
    return conversation;
  };
  return <TicketDrawer open conversations={conversations} activeConversationId={records[0].conversationId}
    onOpenChange={() => {}} onSelect={() => {}} onCreate={async () => records[0]}
    onFork={async () => null} onUpdate={update} canArchive={() => false}
    onArchive={async () => {}} onArchived={() => {}} />;
}
fixture.renderTickets = async () => {
  const { conversations } = await api.listConversations();
  root.render(<Tickets records={conversations} />);
};
Object.assign(fixture, { api, compressImage, blobToDataURL, readSettingsMedia, exportHomePhotos, restoreHomePhotos });

fixture.encodes = [];
const toBlob = HTMLCanvasElement.prototype.toBlob;
HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
  fixture.encodes.push([type, quality]);
  return toBlob.call(this, callback, type, quality);
};
fixture.ready = true;
