import { navigate } from "../../app/router";
import { useController } from "../context";
import { MenuList } from "./MenuList";
import { PixelText } from "./PixelText";

export function PlayerSelect() {
  const c = useController();
  const p2 = c.settings.value.p2Keys === "wasd" ? "W A S D" : "I J K L";
  return (
    <div class="overlay center-col" data-testid="player-select">
      <PixelText size="l">HOW MANY MARBLES?</PixelText>
      <MenuList
        testId="player-menu"
        onBack={() => navigate({ name: "title" })}
        items={[
          {
            label: "1 PLAYER",
            onSelect: () => c.startCourse(1),
            hint: "mouse · keys · pad · touch",
          },
          { label: "2 PLAYERS", onSelect: () => c.startCourse(2), hint: `P2: ${p2} or pad 2` },
          { label: "BACK", onSelect: () => navigate({ name: "title" }) },
        ]}
      />
    </div>
  );
}
