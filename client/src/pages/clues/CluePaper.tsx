import type { Clue } from "../../clueTypes";
import ScrollText from "../../components/ScrollText";
export const PAPER_LAYOUTS = [
  { en: "INDEX", cn: "索引卡" },
  { en: "TICKET", cn: "票根" },
  { en: "BOOKPLATE", cn: "藏書票" },
  { en: "TELEGRAM", cn: "電報" },
  { en: "CALLING CARD", cn: "名片" },
  { en: "STAMP", cn: "郵票" },
  { en: "POSTCARD", cn: "明信片" },
  { en: "LIBRARY CARD", cn: "借書卡" },
];
const big = (title: string, a: number, b: number) => (title.length > 2 ? a : b);
type PaperCard = Pick<
  Clue,
  "title" | "content" | "mode" | "when" | "layout" | "createdAt"
>;
export default function CluePaper({
  card,
  width,
  height,
  preview = false,
}: {
  card: PaperCard;
  width: number;
  height: number;
  preview?: boolean;
}) {
  const label = preview ? "TITLE" : PAPER_LAYOUTS[card.layout].en;
  const date = card.createdAt.slice(5, 10).replace("-", ".");
  const view = [
    () => (
      <>
        <div
          className="tt"
          style={{
            left: "12px",
            top: "13px",
            fontSize: `${big(card.title, 17, 21)}px`,
            letterSpacing: "4px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div className="en" style={{ right: "12px", top: "15px" }}>
          {label}
        </div>
        <div
          style={{
            left: "10px",
            right: "10px",
            top: "40px",
            height: "4px",
            borderTop: "1px solid var(--ink)",
            borderBottom: ".6px solid var(--ink)",
            opacity: ".7",
          }}
        ></div>
        <div
          style={{
            left: "10px",
            right: "10px",
            top: "50px",
            bottom: "8px",
            background:
              "repeating-linear-gradient(transparent 0 11px,rgba(107,131,150,.32) 11px 12px)",
          }}
        ></div>
        <div
          className="tx"
          style={{
            left: "12px",
            right: "12px",
            top: "51px",
            bottom: "auto",
            maxHeight: "none",
            lineHeight: "12px",
            fontSize: "6.5px",
          }}
        >
          {card.content}
        </div>
      </>
    ),
    () => (
      <>
        <div
          style={{
            left: "6px",
            right: "6px",
            top: "6px",
            bottom: "6px",
            border: "1px solid rgba(59,77,90,.5)",
          }}
        ></div>
        <div
          style={{
            left: "116px",
            top: "6px",
            bottom: "6px",
            width: "3px",
            borderLeft: "1px solid rgba(59,77,90,.5)",
            borderRight: ".6px solid rgba(59,77,90,.35)",
          }}
        ></div>
        <div
          className="en"
          style={{
            right: "15px",
            top: "50%",
            writingMode: "vertical-rl",
            transform: "translateY(-50%)",
            letterSpacing: "3px",
          }}
        >
          {label}
        </div>
        <div
          className="en"
          style={{
            left: "15px",
            top: "16px",
            color: "var(--ink)",
            letterSpacing: "3px",
          }}
        >
          ADMIT ONE
        </div>
        <div
          className="tt"
          style={{
            left: "14px",
            top: "36%",
            fontSize: `${big(card.title, 19, 24)}px`,
            letterSpacing: "5px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div
          className="sc"
          style={{ left: "16px", top: "calc(36% + 32px)", fontSize: "13px" }}
        >
          for mian
        </div>
        <div className="tx" style={{ left: "15px", right: "52px" }}>
          {card.content}
        </div>
      </>
    ),
    () => (
      <>
        <div
          style={{
            left: "9px",
            right: "9px",
            top: "9px",
            bottom: "9px",
            border: "1px solid rgba(59,77,90,.55)",
          }}
        ></div>
        <div
          style={{
            left: "13px",
            right: "13px",
            top: "13px",
            bottom: "13px",
            border: ".6px solid rgba(59,77,90,.35)",
          }}
        ></div>
        <div
          className="sc"
          style={{
            left: "0",
            right: "0",
            top: "20%",
            textAlign: "center",
            fontSize: "16px",
          }}
        >
          {label.toLowerCase()}
        </div>
        <div
          className="tt centered"
          style={{
            left: "0",
            right: "0",
            top: "37%",
            textAlign: "center",
            fontSize: `${big(card.title, 18, 23)}px`,
            letterSpacing: "6px",
            paddingLeft: "6px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div className="orn" style={{ top: "calc(37% + 31px)" }}>
          <b></b>
        </div>
        <div
          className="tx"
          style={{
            left: "24px",
            right: "24px",
            bottom: "22px",
            textAlign: "center",
          }}
        >
          {card.content}
        </div>
      </>
    ),
    () => (
      <>
        <div
          style={{
            left: "10px",
            right: "10px",
            top: "10px",
            height: "15px",
            borderTop: "2px solid var(--ink)",
            borderBottom: "1px solid var(--ink)",
          }}
        ></div>
        <div
          className="en"
          style={{
            left: "0",
            right: "0",
            top: "14px",
            textAlign: "center",
            color: "var(--ink)",
            letterSpacing: "5px",
            paddingLeft: "5px",
          }}
        >
          TELEGRAM
        </div>
        <div className="it" style={{ left: "12px", top: "31px" }}>
          from yuyu
        </div>
        <div className="it" style={{ right: "12px", top: "31px" }}>
          to mian
        </div>
        <div
          className="tt"
          style={{
            left: "12px",
            top: "47px",
            fontSize: `${big(card.title, 17, 21)}px`,
            letterSpacing: "4px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div
          className="tx"
          style={{
            left: "12px",
            right: "12px",
            top: "74px",
            bottom: "auto",
            maxHeight: "42px",
          }}
        >
          {card.content}
        </div>
        <div
          className="en bt"
          style={{
            right: "12px",
            bottom: "11px",
            color: "var(--ink)",
            letterSpacing: "3px",
          }}
        >
          STOP
        </div>
      </>
    ),
    () => (
      <>
        <div
          style={{
            left: "10px",
            right: "10px",
            top: "10px",
            bottom: "10px",
            border: "1px solid rgba(59,77,90,.5)",
          }}
        ></div>
        <div
          className="en"
          style={{
            left: "0",
            right: "0",
            top: "24%",
            textAlign: "center",
            letterSpacing: "4px",
            paddingLeft: "4px",
          }}
        >
          {label}
        </div>
        <div
          className="tt centered"
          style={{
            left: "0",
            right: "0",
            top: "calc(24% + 13px)",
            textAlign: "center",
            fontSize: `${big(card.title, 18, 23)}px`,
            letterSpacing: "7px",
            paddingLeft: "7px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div
          style={{
            left: "50%",
            width: "28px",
            marginLeft: "-14px",
            top: `calc(24% + ${big(card.title, 40, 46)}px)`,
            height: "1px",
            background: "rgba(59,77,90,.5)",
          }}
        ></div>
        <div
          className="tx"
          style={{
            left: "22px",
            right: "22px",
            bottom: "auto",
            top: `calc(24% + ${big(card.title, 48, 54)}px)`,
            textAlign: "center",
          }}
        >
          {card.content}
        </div>
        <div className="it bt" style={{ left: "18px", bottom: "17px" }}>
          for mian
        </div>
        <div className="it bt" style={{ right: "18px", bottom: "17px" }}>
          from yuyu
        </div>
      </>
    ),
    () => (
      <>
        <div
          style={{
            left: "12px",
            right: "12px",
            top: "12px",
            bottom: "12px",
            border: "1px solid rgba(59,77,90,.55)",
          }}
        ></div>
        <div
          style={{
            left: "17px",
            right: "17px",
            top: "17px",
            height: "52%",
            border: ".6px solid rgba(59,77,90,.45)",
          }}
        ></div>
        <div
          className="sc"
          style={{
            left: "24px",
            top: "24px",
            fontSize: "14px",
            color: "var(--ink)",
          }}
        >
          {label.toLowerCase()}
        </div>
        <div
          className="tt"
          style={{
            right: "24px",
            top: `calc(17px + 52% - ${big(card.title, 26, 31)}px)`,
            fontSize: `${big(card.title, 17, 22)}px`,
            letterSpacing: "5px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div
          className="en bt"
          style={{
            left: "0",
            right: "0",
            bottom: "17px",
            textAlign: "center",
            color: "var(--ink)",
            letterSpacing: "4px",
            paddingLeft: "4px",
          }}
        >
          MIAN POST
        </div>
        <div
          className="tx"
          style={{
            left: "20px",
            right: "20px",
            bottom: "30px",
            textAlign: "center",
          }}
        >
          {card.content}
        </div>
      </>
    ),
    () => (
      <>
        <div
          style={{
            left: "94px",
            top: "16%",
            height: "70%",
            width: "1px",
            background: "rgba(59,77,90,.45)",
          }}
        ></div>
        <div
          style={{
            right: "12px",
            top: "12px",
            width: "28px",
            height: "32px",
            border: "1px solid var(--ink)",
          }}
        ></div>
        <div
          className="dm"
          style={{ right: "23.5px", top: "25.5px", background: "var(--blue2)" }}
        ></div>
        <div
          className="en"
          style={{
            left: "12px",
            top: "14px",
            color: "var(--ink)",
            letterSpacing: "3px",
          }}
        >
          POST CARD
        </div>
        <div
          className="tt"
          style={{
            left: "12px",
            top: "34%",
            fontSize: `${big(card.title, 15, 19)}px`,
            letterSpacing: "4px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div className="it" style={{ left: "12px", top: "calc(34% + 24px)" }}>
          {label.toLowerCase()}
        </div>
        <div
          className="ln"
          style={{
            left: "102px",
            right: "12px",
            top: "54%",
            background: "rgba(59,77,90,.35)",
          }}
        ></div>
        <div
          className="ln"
          style={{
            left: "102px",
            right: "12px",
            top: "66%",
            background: "rgba(59,77,90,.35)",
          }}
        ></div>
        <div
          className="ln"
          style={{
            left: "102px",
            right: "12px",
            top: "78%",
            background: "rgba(59,77,90,.35)",
          }}
        ></div>
        <div className="tx" style={{ left: "12px", right: "72px" }}>
          {card.content}
        </div>
      </>
    ),
    () => (
      <>
        <div
          className="tt"
          style={{
            left: "12px",
            top: "13px",
            fontSize: `${big(card.title, 16, 20)}px`,
            letterSpacing: "4px",
          }}
        >
          <ScrollText>{card.title}</ScrollText>
        </div>
        <div className="en" style={{ right: "12px", top: "15px" }}>
          {label}
        </div>
        <div
          style={{
            left: "10px",
            right: "10px",
            top: "38px",
            height: "4px",
            borderTop: "1px solid var(--ink)",
            borderBottom: ".6px solid var(--ink)",
            opacity: ".7",
          }}
        ></div>
        <div
          className="en"
          style={{
            left: "14px",
            top: "48px",
            color: "var(--ink)",
            letterSpacing: "2.4px",
          }}
        >
          DATE
        </div>
        <div
          className="en"
          style={{
            left: "58px",
            top: "48px",
            color: "var(--ink)",
            letterSpacing: "2.4px",
          }}
        >
          NOTE
        </div>
        <div
          style={{
            left: "10px",
            right: "10px",
            top: "58px",
            bottom: "10px",
            borderTop: ".8px solid rgba(59,77,90,.5)",
            background:
              "repeating-linear-gradient(transparent 0 15px,rgba(59,77,90,.28) 15px 16px)",
          }}
        ></div>
        <div
          style={{
            left: "50px",
            top: "44px",
            bottom: "10px",
            width: "1px",
            background: "rgba(59,77,90,.4)",
          }}
        ></div>
        <div
          className="it"
          style={{ left: "13px", top: "62px", fontSize: "6px" }}
        >
          2026.{date}
        </div>
        <div
          className="tx"
          style={{
            left: "56px",
            right: "12px",
            top: "61px",
            bottom: "auto",
            maxHeight: "none",
            lineHeight: "16px",
            fontSize: "6.3px",
          }}
        >
          {card.content}
        </div>
      </>
    ),
  ];
  return (
    <div
      className={"paper" + (card.mode === "trigger" ? " tr" : "")}
      data-layout={card.layout}
      style={{
        height: Math.round((160 * height) / width),
        transform: "scale(" + width / 160 + ")",
      }}
    >
      {view[card.layout]()}
      {card.mode === "trigger" && (
        <div className="tape">
          <svg viewBox="0 0 7 7">
            <path
              d="M3.5 .6 L6.4 3.5 L3.5 6.4 L.6 3.5 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth=".8"
              strokeLinejoin="miter"
            />
          </svg>
          <ScrollText>when {card.when || "還沒寫"}</ScrollText>
        </div>
      )}
    </div>
  );
}
