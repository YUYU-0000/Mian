import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { notify } from "../../components/Notify";
import type { ClueWall } from "../../clueTypes";

export function useClueWall() {
  const [wall, setWall] = useState<ClueWall | null>(null);
  const current = useRef<ClueWall | null>(null);
  const writes = useRef(Promise.resolve());
  const replace = (next: ClueWall) => {
    current.current = next;
    setWall(next);
    return next;
  };
  useEffect(() => {
    return api.clues.watch(replace);
  }, []);
  const update = (change: (wall: ClueWall) => ClueWall) =>
    replace(change(current.current!));
  const persist = (next = current.current!) => {
    const request = writes.current.then(() => api.saveClueWall(next));
    writes.current = request.then(
      () => {},
      (error) => { notify.fail("線索保存失敗", error); },
    );
    return request;
  };
  const commit = async (change: (wall: ClueWall) => ClueWall) => {
    const next = change(current.current!);
    await persist(next);
    replace(next);
  };
  return { wall, current, update, persist, commit };
}
