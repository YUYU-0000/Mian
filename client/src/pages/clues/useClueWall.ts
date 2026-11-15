import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { notify } from "../../components/Notify";
import type { ClueWall } from "../../clueTypes";

export function useClueWall() {
  const [wall, setWall] = useState<ClueWall | null>(null);
  const current = useRef<ClueWall | null>(null);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    void api
      .clues()
      .then((data) => {
        current.current = data;
        setWall(data);
      })
      .catch((error) => notify.fail("線索讀取失敗", error));
  }, []);
  const update = (change: (wall: ClueWall) => ClueWall) => {
    const next = change(current.current!);
    current.current = next;
    setWall(next);
    return next;
  };
  const persist = (next = current.current!) => {
    const request = writes.current.then(() => api.saveClueWall(next));
    writes.current = request.then(
      () => {},
      (error) => { notify.fail("線索保存失敗", error); },
    );
    return request;
  };
  return { wall, current, update, persist };
}
