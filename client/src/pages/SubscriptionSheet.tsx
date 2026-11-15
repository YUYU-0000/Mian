import { pad2 } from "../format";
import type { Provider, Quota, Subscription } from "../connectionTypes";
import AnimatedText from "../components/AnimatedText";
import ScrollText from "../components/ScrollText";
import Media from "../components/Media";
import { notify } from "../components/Notify";

export type SubscriptionProvider = {
  id: Provider;
  name: string;
  giant: string;
  art: string;
  size: number;
};
export type SubscriptionState = Subscription & {
  quota: Quota | null;
  loaded: boolean;
  quotaLoading?: boolean;
};

export default function SubscriptionSheet({
  provider,
  subscription: s,
  index,
  total,
  onUseCodex,
  onAccount,
  onModels,
  onQuota,
  onWorkspace,
}: {
  provider: SubscriptionProvider;
  subscription: SubscriptionState;
  index: number;
  total: number;
  onUseCodex: () => void;
  onAccount: (id: Provider) => Promise<void>;
  onModels: (id: Provider) => Promise<void>;
  onQuota: (id: Provider) => Promise<void>;
  onWorkspace: () => Promise<void>;
}) {
  return (
    <div className="cover" data-p={provider.id}>
      <div
        className="cover-art js-art"
        style={{ backgroundColor: provider.art }}
        onClick={(e) => {
          if (!(e.target as Element).closest("input"))
            e.currentTarget.querySelector("input")!.click();
        }}
      >
        <Media storageKey={provider.id} cover />
        <span className="cover-count">{`${pad2(index + 1)} / ${pad2(total)}`}</span>
      </div>
      <div className="cover-band">
        <div
          className="cover-giant"
          style={{ fontSize: provider.size }}
          role={provider.id === "codex" ? "button" : undefined}
          tabIndex={provider.id === "codex" ? 0 : undefined}
          aria-label={provider.id === "codex" ? "使用 Codex 通道" : undefined}
          onClick={provider.id === "codex" ? onUseCodex : undefined}
          onKeyDown={
            provider.id === "codex"
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onUseCodex();
                  }
                }
              : undefined
          }
        >
          {provider.giant}
        </div>
        <div className="cover-band-inner">
          <div className="cover-title">{provider.name}</div>
          <div className="cover-sub">訂閱連接</div>
          <div className="cover-links">
            <button
              className="cover-link js-account"
              type="button"
              onClick={() => void onAccount(provider.id)}
            >
              <span className="cover-link-label">ACCOUNT</span>
              <ScrollText className="cover-link-value js-account-v">
                <AnimatedText
                  className="cover-link-text"
                  text={
                    s.loggedIn
                      ? (s.plan || "SIGNED IN").toUpperCase()
                      : "未登入"
                  }
                />
              </ScrollText>
            </button>
            <button
              className="cover-link js-model"
              type="button"
              onClick={() => void onModels(provider.id)}
            >
              <span className="cover-link-label">MODEL</span>
              <ScrollText className="cover-link-value js-model-v">
                <AnimatedText
                  className="cover-link-text"
                  text={s.model || "未設定"}
                />
              </ScrollText>
            </button>
            <button
              className="cover-link js-quota"
              type="button"
              onClick={() =>
                s.loggedIn ? void onQuota(provider.id) : notify.note("請先登入")
              }
            >
              <span className="cover-link-label">QUOTA</span>
              <ScrollText className="cover-link-value js-quota-v">
                <AnimatedText
                  className="cover-link-text"
                  text={
                    s.quotaLoading
                      ? "讀取中"
                      : s.quota
                        ? `剩餘 ${s.quota.left}%`
                        : "—"
                  }
                />
              </ScrollText>
            </button>
          </div>
        </div>
        <div className="cover-foot">
          <AnimatedText
            className={`cover-status js-status${s.loggedIn ? " is-connected" : ""}`}
            text={s.loggedIn ? "CONNECTED" : "NOT CONNECTED"}
          />
          {provider.id === "codex" && (
            <button
              type="button"
              className="cover-workspace"
              onClick={() => void onWorkspace()}
            >
              WORKSPACE
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
