import Media from "../components/Media";
import type { AvatarRole } from "../avatars";
import { wallpaperFlower } from "./SettingsArt";

export default function SettingsAvatar({
  role,
  active,
}: {
  role: AvatarRole;
  active: boolean;
}) {
  return (
    <div className="avatar-page" data-role={role}>
      <div className="paper-holes">
        <div className="hole" />
        <div className="hole" />
        <div className="hole" />
        <div className="hole" />
      </div>
      <div className="wp-layout">
        <div className="wp-backing-wrapper">
          <div className="wp-backing" />
        </div>
        <div className="wp-photo-container">
          <div className="wp-tape" />
          <div className="polaroid">
            <div className="polaroid-img-placeholder">
              <Media
                storageKey={`avatar_${role}`}
                active={active}
                avatar={role}
              />
            </div>
          </div>
        </div>
        <div className="wp-typography">
          <div className="wp-typo-title">
            {role === "assistant" ? "彼方肖像" : "此方肖像"}
          </div>
          <div className="wp-typo-divider" />
          <div className="wp-typo-subtitle">
            Collected &amp; Preserved
            <br />
            For Our Little Corner
          </div>
        </div>
        <div className="wp-typo-vertical">
          <span>COLLECTION</span>
          <span>DETAIL</span>
        </div>
        <div className="wp-flower-container">
          <div className="wp-flower-tape" />
          {wallpaperFlower}
        </div>
        <div className="wp-note-card">
          <svg
            className="wp-note-clip"
            viewBox="0 0 24 60"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 8,14 L 8,6 A 4,4 0 0,1 16,6 L 16,42 A 3,3 0 0,1 10,42 L 10,20"
              stroke="#8ba5b8"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <div className="wp-note-text">
            Species: Crab &amp; Fish
            <br />
            Habitat: The Drain
            <br />
            Status: Together
            <br />
            Notes: Stay close,
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;stay warm.
          </div>
        </div>
      </div>
    </div>
  );
}
