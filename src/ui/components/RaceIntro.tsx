import type { EntityType } from "../../level/types";
import { useController } from "../context";
import { PixelText } from "./PixelText";

const HAZARD_LABEL: Record<EntityType, string> = {
  steelie: "STEELIE",
  muncher: "MUNCHER",
  hoover: "HOOVER",
  hammer: "HAMMER",
  catapult: "CATAPULT",
  wave: "WAVE FLOOR",
  platform: "LIFT",
  pipe: "PIPE",
  funnel: "FUNNEL",
};

export function RaceIntro() {
  const c = useController();
  const info = c.intro.value;
  if (!info) return null;
  return (
    <div class="overlay center-col race-intro" data-testid="race-intro">
      <PixelText size="m" tone="dim">
        {info.custom ? info.label : `RACE ${info.number}`}
      </PixelText>
      <PixelText size="xl">{info.name.toUpperCase()}</PixelText>
      <div class="intro-times">
        {info.timeSec.map((t, i) => (
          <PixelText
            key={i}
            size="l"
            tone={info.timeSec.length > 1 ? (i === 0 ? "p1" : "p2") : "normal"}
          >
            TIME {String(t).padStart(2, "0")}
          </PixelText>
        ))}
      </div>
      {info.custom && (
        <PixelText size="s" tone="dim">
          PAR {info.par}s
        </PixelText>
      )}
      {info.hazards.length > 0 && (
        <div class="hazards">
          {info.hazards.map((h) => (
            <span key={h} class={`hazard hz-${h}`}>
              {HAZARD_LABEL[h]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
